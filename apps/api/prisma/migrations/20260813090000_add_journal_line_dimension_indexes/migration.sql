-- Project-scoped reporting (Project Actual P&L, ADR-013): index the GL dimension columns
CREATE INDEX "journal_lines_project_id_idx" ON "journal_lines"("project_id");
CREATE INDEX "journal_lines_contract_id_idx" ON "journal_lines"("contract_id");
