INSERT INTO User (id, name, email, passwordHash, role, active, createdAt, updatedAt) VALUES ('seed_admin_1', 'Administrador', 'admin@empresa.local', '$2a$12$LQpiosbGHAg3P9HSzZFYNebtkrGMSOIUOIjnDU/OQw.fB3q7UW99y', 'ADMIN', true, NOW(3), NOW(3));
INSERT INTO Sector (id, name, description, active, createdAt) VALUES ('seed_sector_1', 'Suporte Geral', 'Setor padrao de suporte', true, NOW(3));
INSERT INTO SectorMembership (id, userId, sectorId, role, createdAt) VALUES ('seed_mem_1', 'seed_admin_1', 'seed_sector_1', 'ADMIN', NOW(3));
