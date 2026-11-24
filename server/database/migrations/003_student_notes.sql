CREATE TABLE IF NOT EXISTS student_notes (
 student_id CHAR(36) PRIMARY KEY,
 note TEXT NOT NULL,
 version INT NOT NULL DEFAULT 1,
 FOREIGN KEY (student_id) REFERENCES users(id)
) ENGINE=InnoDB;
