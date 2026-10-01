-- Removal hides the point from the operation without breaking delivery receipts.
ALTER TABLE "Ponto" ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Ponto" ADD CONSTRAINT ponto_removed_inactive CHECK ("deletedAt" IS NULL OR NOT ativo);
DROP INDEX "Ponto_municipioId_ativo_idx";
CREATE INDEX "Ponto_municipioId_deletedAt_ativo_idx" ON "Ponto"("municipioId", "deletedAt", ativo);
