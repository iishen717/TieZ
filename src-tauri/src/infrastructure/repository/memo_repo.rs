use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize)]
pub struct Memo {
    pub id: i64,
    pub title: String,
    pub content: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MemoSummary {
    pub id: i64,
    pub title: String,
    pub updated_at: i64,
}

pub trait MemoRepository {
    fn list(&self) -> Result<Vec<MemoSummary>, String>;
    fn get(&self, id: i64) -> Result<Option<Memo>, String>;
    fn create(&self, title: &str) -> Result<Memo, String>;
    fn update(&self, id: i64, title: &str, content: &str) -> Result<i64, String>;
    fn delete(&self, id: i64) -> Result<(), String>;
}

pub struct SqliteMemoRepository {
    conn: Arc<Mutex<Connection>>,
}

impl SqliteMemoRepository {
    pub fn new(conn: Arc<Mutex<Connection>>) -> Self {
        Self { conn }
    }
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl MemoRepository for SqliteMemoRepository {
    fn list(&self) -> Result<Vec<MemoSummary>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, title, updated_at FROM memos ORDER BY updated_at DESC, id DESC")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(MemoSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    updated_at: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut memos = Vec::new();
        for row in rows {
            memos.push(row.map_err(|e| e.to_string())?);
        }
        Ok(memos)
    }

    fn get(&self, id: i64) -> Result<Option<Memo>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT id, title, content, created_at, updated_at FROM memos WHERE id = ?1",
            params![id],
            |row| {
                Ok(Memo {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    content: row.get(2)?,
                    created_at: row.get(3)?,
                    updated_at: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    fn create(&self, title: &str) -> Result<Memo, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_ms();
        conn.execute(
            "INSERT INTO memos (title, content, created_at, updated_at) VALUES (?1, '', ?2, ?2)",
            params![title, now],
        )
        .map_err(|e| e.to_string())?;

        Ok(Memo {
            id: conn.last_insert_rowid(),
            title: title.to_string(),
            content: String::new(),
            created_at: now,
            updated_at: now,
        })
    }

    fn update(&self, id: i64, title: &str, content: &str) -> Result<i64, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let now = now_ms();
        let changed = conn
            .execute(
                "UPDATE memos SET title = ?1, content = ?2, updated_at = ?3 WHERE id = ?4",
                params![title, content, now, id],
            )
            .map_err(|e| e.to_string())?;

        if changed == 0 {
            return Err("Memo not found".to_string());
        }
        Ok(now)
    }

    fn delete(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM memos WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_repo() -> SqliteMemoRepository {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE memos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL DEFAULT '',
                content TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            )",
            [],
        )
        .unwrap();
        SqliteMemoRepository::new(Arc::new(Mutex::new(conn)))
    }

    #[test]
    fn memo_crud_roundtrip() {
        let repo = setup_repo();

        let created = repo.create("First memo").unwrap();
        assert!(created.id > 0);
        assert_eq!(created.title, "First memo");
        assert!(created.content.is_empty());

        let list = repo.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "First memo");

        let updated_at = repo.update(created.id, "Renamed", "hello").unwrap();
        assert!(updated_at > 0);

        let loaded = repo.get(created.id).unwrap().unwrap();
        assert_eq!(loaded.title, "Renamed");
        assert_eq!(loaded.content, "hello");

        repo.delete(created.id).unwrap();
        assert!(repo.get(created.id).unwrap().is_none());
        assert!(repo.list().unwrap().is_empty());
    }
}
