import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { ChevronDown, Download, Eraser, FilePlus2, Trash2 } from "lucide-react";
import ConfirmDialog from "../../../shared/components/ConfirmDialog";

interface MemoSummary {
    id: number;
    title: string;
    updated_at: number;
}

interface Memo extends MemoSummary {
    content: string;
    created_at: number;
}

interface MemoManagerProps {
    t: (key: string) => string;
    theme: string;
}

type SaveState = "idle" | "saving" | "saved" | "error";
type ConfirmAction = "clear" | "delete" | null;

const fallbackUntitled = "未命名备忘录";
const LAST_MEMO_STORAGE_KEY = "tiez_memo_last_id";

const readLastMemoId = (): number | null => {
    try {
        const raw = window.localStorage.getItem(LAST_MEMO_STORAGE_KEY);
        const id = raw ? Number(raw) : NaN;
        return Number.isInteger(id) && id > 0 ? id : null;
    } catch {
        return null;
    }
};

const saveLastMemoId = (id: number | null) => {
    try {
        if (id == null) {
            window.localStorage.removeItem(LAST_MEMO_STORAGE_KEY);
        } else {
            window.localStorage.setItem(LAST_MEMO_STORAGE_KEY, String(id));
        }
    } catch {
        // Ignore storage errors.
    }
};

const displayTitle = (title: string, t: (key: string) => string) =>
    title.trim() || t("memo_untitled") || fallbackUntitled;

const formatTime = (timestamp: number) => {
    try {
        return new Date(timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
        });
    } catch {
        return "";
    }
};

const sanitizeFileName = (name: string) => {
    const cleaned = name
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/[. ]+$/g, "");
    return cleaned || "memo";
};

const MemoManager = ({ t, theme }: MemoManagerProps) => {
    const [memos, setMemos] = useState<MemoSummary[]>([]);
    const [currentId, setCurrentId] = useState<number | null>(null);
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [savedAt, setSavedAt] = useState<number | null>(null);
    const [statusText, setStatusText] = useState("");
    const [isBootstrapping, setIsBootstrapping] = useState(true);
    const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

    const currentIdRef = useRef<number | null>(null);
    const titleRef = useRef("");
    const contentRef = useRef("");
    const lastSavedTitleRef = useRef("");
    const lastSavedContentRef = useRef("");
    const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const saveChainRef = useRef<Promise<void>>(Promise.resolve());
    const skipSaveRef = useRef(true);
    const titleInputRef = useRef<HTMLInputElement | null>(null);
    const contentInputRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        currentIdRef.current = currentId;
    }, [currentId]);

    useEffect(() => {
        titleRef.current = title;
    }, [title]);

    useEffect(() => {
        contentRef.current = content;
    }, [content]);

    const requestWindowFocus = useCallback(() => {
        invoke("activate_window_focus").catch(console.error);
    }, []);

    const showStatus = useCallback((text: string) => {
        setStatusText(text);
        if (statusTimerRef.current) {
            clearTimeout(statusTimerRef.current);
        }
        statusTimerRef.current = setTimeout(() => {
            statusTimerRef.current = null;
            setStatusText("");
        }, 2500);
    }, []);

    const loadMemo = useCallback(async (id: number) => {
        const memo = await invoke<Memo | null>("get_memo", { id });
        if (!memo) {
            return;
        }

        skipSaveRef.current = true;
        currentIdRef.current = memo.id;
        titleRef.current = memo.title;
        contentRef.current = memo.content;
        lastSavedTitleRef.current = memo.title;
        lastSavedContentRef.current = memo.content;
        setCurrentId(memo.id);
        setTitle(memo.title);
        setContent(memo.content);
        setSavedAt(memo.updated_at);
        setSaveState("saved");
        saveLastMemoId(memo.id);
    }, []);

    const queueSave = useCallback(() => {
        const id = currentIdRef.current;
        if (id == null) {
            return Promise.resolve();
        }

        const nextTitle = titleRef.current;
        const nextContent = contentRef.current;
        setSaveState("saving");

        saveChainRef.current = saveChainRef.current
            .catch(() => undefined)
            .then(async () => {
                const updatedAt = await invoke<number>("update_memo", {
                    id,
                    title: nextTitle,
                    content: nextContent
                });

                lastSavedTitleRef.current = nextTitle;
                lastSavedContentRef.current = nextContent;

                if (currentIdRef.current === id) {
                    setSavedAt(updatedAt);
                    setSaveState("saved");
                    setMemos((prev) =>
                        prev.map((memo) =>
                            memo.id === id
                                ? { ...memo, title: nextTitle, updated_at: updatedAt }
                                : memo
                        )
                    );
                }
            })
            .catch((error) => {
                console.error("Failed to save memo:", error);
                if (currentIdRef.current === id) {
                    setSaveState("error");
                }
            });

        return saveChainRef.current;
    }, []);

    const flushSave = useCallback(async () => {
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }

        if (currentIdRef.current == null) {
            return;
        }

        if (
            titleRef.current !== lastSavedTitleRef.current ||
            contentRef.current !== lastSavedContentRef.current
        ) {
            await queueSave();
        } else {
            await saveChainRef.current.catch(() => undefined);
        }
    }, [queueSave]);

    useEffect(() => {
        let cancelled = false;

        const bootstrap = async () => {
            try {
                let list = await invoke<MemoSummary[]>("get_memos");
                let targetId: number;

                if (list.length === 0) {
                    const created = await invoke<Memo>("create_memo", { title: "" });
                    list = [{
                        id: created.id,
                        title: created.title,
                        updated_at: created.updated_at
                    }];
                    targetId = created.id;
                } else {
                    const savedId = readLastMemoId();
                    const savedMemo = savedId == null
                        ? undefined
                        : list.find((memo) => memo.id === savedId);
                    targetId = savedMemo ? savedMemo.id : list[0].id;
                }

                if (cancelled) {
                    return;
                }

                setMemos(list);
                await loadMemo(targetId);
            } catch (error) {
                console.error("Failed to load memos:", error);
                if (!cancelled) {
                    setSaveState("error");
                }
            } finally {
                if (!cancelled) {
                    setIsBootstrapping(false);
                }
            }
        };

        void bootstrap();

        return () => {
            cancelled = true;
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
            }
            if (statusTimerRef.current) {
                clearTimeout(statusTimerRef.current);
            }
            void flushSave();
        };
    }, [flushSave, loadMemo]);

    useEffect(() => {
        if (skipSaveRef.current) {
            skipSaveRef.current = false;
            return;
        }

        if (currentIdRef.current == null) {
            return;
        }

        setSaveState("saving");
        if (saveTimerRef.current) {
            clearTimeout(saveTimerRef.current);
        }
        saveTimerRef.current = setTimeout(() => {
            saveTimerRef.current = null;
            void queueSave();
        }, 500);

        return () => {
            if (saveTimerRef.current) {
                clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
        };
    }, [content, currentId, queueSave, title]);

    const handleSelect = async (event: ChangeEvent<HTMLSelectElement>) => {
        const nextId = Number(event.target.value);
        if (!nextId || nextId === currentIdRef.current) {
            return;
        }
        await flushSave();
        await loadMemo(nextId);
    };

    const createMemo = async () => {
        await flushSave();
        try {
            const created = await invoke<Memo>("create_memo", { title: "" });
            setMemos((prev) => [
                { id: created.id, title: created.title, updated_at: created.updated_at },
                ...prev
            ]);
            await loadMemo(created.id);
            requestWindowFocus();
            requestAnimationFrame(() => titleInputRef.current?.focus());
        } catch (error) {
            console.error("Failed to create memo:", error);
            showStatus(t("memo_save_failed") || "保存失败");
        }
    };

    const deleteMemo = async () => {
        const id = currentIdRef.current;
        setConfirmAction(null);
        if (id == null) {
            return;
        }

        await flushSave();
        try {
            await invoke("delete_memo", { id });
            let list = await invoke<MemoSummary[]>("get_memos");

            if (list.length === 0) {
                const created = await invoke<Memo>("create_memo", { title: "" });
                list = [{
                    id: created.id,
                    title: created.title,
                    updated_at: created.updated_at
                }];
            }

            setMemos(list);
            await loadMemo(list[0].id);
        } catch (error) {
            console.error("Failed to delete memo:", error);
            showStatus(t("memo_save_failed") || "保存失败");
        }
    };

    const clearContent = () => {
        setConfirmAction(null);
        skipSaveRef.current = false;
        titleRef.current = title;
        contentRef.current = "";
        setContent("");
        requestAnimationFrame(() => contentInputRef.current?.focus());
    };

    const exportMemo = async () => {
        const id = currentIdRef.current;
        if (id == null) {
            return;
        }

        const name = displayTitle(titleRef.current, t);
        try {
            const path = await save({
                defaultPath: `${sanitizeFileName(name)}.md`,
                filters: [{ name: "Markdown", extensions: ["md"] }]
            });

            if (!path) {
                return;
            }

            await flushSave();
            await invoke("export_memo", { id, path });
            showStatus(t("memo_exported") || "已导出");
        } catch (error) {
            console.error("Failed to export memo:", error);
            showStatus(t("memo_export_failed") || "导出失败");
        }
    };

    const handleConfirm = () => {
        if (confirmAction === "delete") {
            void deleteMemo();
        } else if (confirmAction === "clear") {
            clearContent();
        }
    };

    let saveStatus = "";
    if (statusText) {
        saveStatus = statusText;
    } else if (saveState === "saving") {
        saveStatus = t("memo_saving") || "保存中...";
    } else if (saveState === "error") {
        saveStatus = t("memo_save_failed") || "保存失败";
    } else if (savedAt) {
        saveStatus = `${t("memo_saved") || "已保存"} · ${formatTime(savedAt)}`;
    }

    return (
        <div className={`memo-manager theme-${theme}`} onMouseDown={requestWindowFocus}>
            <div className="memo-panel">
                <div className="memo-select-wrap">
                    <select
                        className="memo-select"
                        value={currentId ?? ""}
                        onChange={(event) => void handleSelect(event)}
                        onFocus={requestWindowFocus}
                        disabled={isBootstrapping || memos.length === 0}
                        aria-label={t("memo_manager") || "备忘录"}
                    >
                        {memos.map((memo) => (
                            <option key={memo.id} value={memo.id}>
                                {displayTitle(memo.title, t)}
                            </option>
                        ))}
                    </select>
                    <ChevronDown className="memo-select-icon" size={14} />
                </div>

                <input
                    ref={titleInputRef}
                    className="memo-title-input"
                    type="text"
                    value={title}
                    placeholder={t("memo_title_placeholder") || "备忘录标题"}
                    disabled={isBootstrapping || currentId == null}
                    onFocus={requestWindowFocus}
                    onChange={(event) => setTitle(event.target.value)}
                />

                <textarea
                    ref={contentInputRef}
                    className="memo-content-input"
                    value={content}
                    placeholder={t("memo_content_placeholder") || "写点什么..."}
                    disabled={isBootstrapping || currentId == null}
                    onFocus={requestWindowFocus}
                    onChange={(event) => setContent(event.target.value)}
                />

                <div className="memo-actions">
                    <button
                        type="button"
                        className="memo-action-btn"
                        onClick={() => void createMemo()}
                        disabled={isBootstrapping}
                    >
                        <FilePlus2 size={13} />
                        <span>{t("memo_new") || "新建"}</span>
                    </button>
                    <button
                        type="button"
                        className="memo-action-btn"
                        onClick={() => setConfirmAction("clear")}
                        disabled={isBootstrapping || currentId == null || content.length === 0}
                    >
                        <Eraser size={13} />
                        <span>{t("memo_clear") || "清空"}</span>
                    </button>
                    <button
                        type="button"
                        className="memo-action-btn"
                        onClick={() => void exportMemo()}
                        disabled={isBootstrapping || currentId == null}
                    >
                        <Download size={13} />
                        <span>{t("memo_export") || "导出"}</span>
                    </button>
                    <button
                        type="button"
                        className="memo-action-btn danger"
                        onClick={() => setConfirmAction("delete")}
                        disabled={isBootstrapping || currentId == null}
                    >
                        <Trash2 size={13} />
                        <span>{t("memo_delete") || "删除"}</span>
                    </button>
                </div>

                <div className="memo-status">{saveStatus}</div>
            </div>

            <ConfirmDialog
                open={confirmAction !== null}
                title={
                    confirmAction === "delete"
                        ? t("memo_delete_confirm_title") || "删除备忘录"
                        : t("memo_clear_confirm_title") || "清空备忘录"
                }
                message={
                    confirmAction === "delete"
                        ? (t("memo_delete_confirm_message") || "确定删除「{name}」吗？此操作无法撤销。")
                            .replace("{name}", displayTitle(title, t))
                        : t("memo_clear_confirm_message") || "确定清空当前备忘录的正文吗？标题会保留。"
                }
                theme={theme}
                confirmLabel={t("confirm") || "确认"}
                cancelLabel={t("cancel") || "取消"}
                onConfirm={handleConfirm}
                onClose={() => setConfirmAction(null)}
            />
        </div>
    );
};

export default MemoManager;
