use tauri::State;

use crate::database::DbState;
use crate::error::{AppError, AppResult};
use crate::infrastructure::repository::memo_repo::{Memo, MemoRepository, MemoSummary};

#[tauri::command]
pub fn get_memos(state: State<'_, DbState>) -> AppResult<Vec<MemoSummary>> {
    state.memo_repo.list().map_err(AppError::from)
}

#[tauri::command]
pub fn get_memo(state: State<'_, DbState>, id: i64) -> AppResult<Option<Memo>> {
    state.memo_repo.get(id).map_err(AppError::from)
}

#[tauri::command]
pub fn create_memo(state: State<'_, DbState>, title: String) -> AppResult<Memo> {
    state.memo_repo.create(&title).map_err(AppError::from)
}

#[tauri::command]
pub fn update_memo(
    state: State<'_, DbState>,
    id: i64,
    title: String,
    content: String,
) -> AppResult<i64> {
    state
        .memo_repo
        .update(id, &title, &content)
        .map_err(AppError::from)
}

#[tauri::command]
pub fn delete_memo(state: State<'_, DbState>, id: i64) -> AppResult<()> {
    state.memo_repo.delete(id).map_err(AppError::from)
}

#[tauri::command]
pub fn export_memo(state: State<'_, DbState>, id: i64, path: String) -> AppResult<()> {
    let memo = state
        .memo_repo
        .get(id)
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::Validation("Memo not found".to_string()))?;

    let title = memo.title.trim();
    let body = if title.is_empty() {
        memo.content
    } else {
        format!("# {}\n\n{}", title, memo.content)
    };

    std::fs::write(path, body).map_err(AppError::from)
}
