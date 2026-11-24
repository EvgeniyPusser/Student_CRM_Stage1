CREATE TABLE IF NOT EXISTS materials (
 id CHAR(36) PRIMARY KEY,
 group_id CHAR(36) NOT NULL,
 lesson_id CHAR(36),
 author_id CHAR(36) NOT NULL,
 title VARCHAR(200) NOT NULL,
 body MEDIUMTEXT NOT NULL,
 links JSON NOT NULL,
 state ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
 version INT NOT NULL DEFAULT 1,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(group_id) REFERENCES study_groups(id),
 FOREIGN KEY(lesson_id) REFERENCES lessons(id),
 FOREIGN KEY(author_id) REFERENCES users(id),
 INDEX(group_id,state,created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS material_files (
 id CHAR(36) PRIMARY KEY,
 material_id CHAR(36) NOT NULL,
 file_version INT NOT NULL,
 filename VARCHAR(200) NOT NULL,
 bytes INT NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 FOREIGN KEY(material_id) REFERENCES materials(id),
 UNIQUE(material_id,file_version)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
 id CHAR(36) PRIMARY KEY,
 recipient_id CHAR(36) NOT NULL,
 kind VARCHAR(40) NOT NULL,
 object_id CHAR(36) NOT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 read_at DATETIME(3),
 FOREIGN KEY(recipient_id) REFERENCES users(id),
 UNIQUE(recipient_id,kind,object_id),
 INDEX(recipient_id,created_at,id)
) ENGINE=InnoDB;
