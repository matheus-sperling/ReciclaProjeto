-- Roles have no login until provision-roles.ts assigns private credentials.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='recicla_app') THEN CREATE ROLE recicla_app NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='recicla_auth') THEN CREATE ROLE recicla_auth NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO recicla_app,recicla_auth;
GRANT SELECT,INSERT,UPDATE ON "Municipio","Morador","Ponto" TO recicla_app;
GRANT SELECT,INSERT ON "Entrega","Auditoria" TO recicla_app;
GRANT SELECT ON "Material" TO recicla_app;
GRANT SELECT ON "user" TO recicla_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON "user","session","account","verification","twoFactor","rateLimit" TO recicla_auth;
GRANT SELECT ON "Municipio" TO recicla_auth;
GRANT INSERT ON "Auditoria" TO recicla_auth;

ALTER TABLE "user" ADD CONSTRAINT user_role_scope CHECK (
  (role='administrador' AND "municipioId" IS NULL) OR (role IN ('gestor','coletor') AND "municipioId" IS NOT NULL)
);
CREATE UNIQUE INDEX one_platform_administrator ON "user" (role) WHERE role='administrador';
ALTER TABLE "Municipio" ADD CONSTRAINT only_ms CHECK (uf='MS');
ALTER TABLE "Entrega" ADD CONSTRAINT positive_grams CHECK (gramas BETWEEN 1 AND 10000000);

CREATE FUNCTION public.recicla_actor() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('recicla.user_id',true),'')::uuid $$;
CREATE FUNCTION public.recicla_scope() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('recicla.municipio_id',true),'')::uuid $$;
CREATE FUNCTION public.recicla_role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('recicla.role',true),'') $$;
REVOKE ALL ON FUNCTION public.recicla_actor(),public.recicla_scope(),public.recicla_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recicla_actor(),public.recicla_scope(),public.recicla_role() TO recicla_app;

ALTER TABLE "Municipio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Municipio" FORCE ROW LEVEL SECURITY;
CREATE POLICY municipio_app ON "Municipio" TO recicla_app USING (recicla_role()='administrador' OR (id=recicla_scope() AND ativo)) WITH CHECK (recicla_role()='administrador');
CREATE POLICY municipio_auth ON "Municipio" FOR SELECT TO recicla_auth USING (true);

ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user" FORCE ROW LEVEL SECURITY;
CREATE POLICY user_auth ON "user" TO recicla_auth USING (true) WITH CHECK (true);
CREATE POLICY user_app ON "user" FOR SELECT TO recicla_app USING (
  "municipioId"=recicla_scope() AND (recicla_role() IN ('gestor','administrador') OR id=recicla_actor())
);

ALTER TABLE "Morador" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Morador" FORCE ROW LEVEL SECURITY;
CREATE POLICY morador_read ON "Morador" FOR SELECT TO recicla_app USING (
  "municipioId"=recicla_scope() AND (recicla_role() IN ('gestor','administrador') OR (recicla_role()='coletor' AND ativo))
  AND EXISTS(SELECT 1 FROM "Municipio" m WHERE m.id="municipioId" AND (m.ativo OR recicla_role()='administrador'))
);
CREATE POLICY morador_write ON "Morador" FOR ALL TO recicla_app USING (
  "municipioId"=recicla_scope() AND recicla_role() IN ('gestor','administrador') AND EXISTS(SELECT 1 FROM "Municipio" m WHERE m.id="municipioId" AND (m.ativo OR recicla_role()='administrador'))
) WITH CHECK ("municipioId"=recicla_scope() AND recicla_role() IN ('gestor','administrador') AND EXISTS(SELECT 1 FROM "Municipio" m WHERE m.id="municipioId" AND m.ativo));

ALTER TABLE "Ponto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Ponto" FORCE ROW LEVEL SECURITY;
CREATE POLICY ponto_read ON "Ponto" FOR SELECT TO recicla_app USING (
  "municipioId"=recicla_scope() AND recicla_role() IN ('gestor','coletor','administrador')
  AND EXISTS(SELECT 1 FROM "Municipio" m WHERE m.id="municipioId" AND (m.ativo OR recicla_role()='administrador'))
);
CREATE POLICY ponto_write ON "Ponto" FOR ALL TO recicla_app USING (
  "municipioId"=recicla_scope() AND recicla_role() IN ('gestor','administrador') AND EXISTS(SELECT 1 FROM "Municipio" m WHERE m.id="municipioId" AND (m.ativo OR recicla_role()='administrador'))
) WITH CHECK ("municipioId"=recicla_scope() AND recicla_role() IN ('gestor','administrador') AND EXISTS(SELECT 1 FROM "Municipio" m WHERE m.id="municipioId" AND m.ativo));

ALTER TABLE "Entrega" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Entrega" FORCE ROW LEVEL SECURITY;
CREATE POLICY entrega_read ON "Entrega" FOR SELECT TO recicla_app USING (
  "municipioId"=recicla_scope() AND (recicla_role() IN ('gestor','administrador') OR (recicla_role()='coletor' AND "coletorId"=recicla_actor()))
  AND EXISTS(SELECT 1 FROM "Municipio" m WHERE m.id="municipioId" AND (m.ativo OR recicla_role()='administrador'))
);
CREATE POLICY entrega_insert ON "Entrega" FOR INSERT TO recicla_app WITH CHECK (
  "municipioId"=recicla_scope() AND "coletorId"=recicla_actor() AND recicla_role() IN ('gestor','coletor')
  AND EXISTS(SELECT 1 FROM "Municipio" m WHERE m.id="municipioId" AND m.ativo)
);

ALTER TABLE "Auditoria" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Auditoria" FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON "Auditoria" FOR SELECT TO recicla_app USING (
  recicla_role()='administrador' OR (recicla_role()='gestor' AND "municipioId"=recicla_scope())
);
CREATE POLICY audit_insert ON "Auditoria" FOR INSERT TO recicla_app WITH CHECK (
  "actorId"=recicla_actor() AND (recicla_role()='administrador' OR (recicla_role()='gestor' AND "municipioId"=recicla_scope()))
);
CREATE POLICY audit_auth ON "Auditoria" FOR INSERT TO recicla_auth WITH CHECK (true);

INSERT INTO "Material" (id,nome) VALUES ('papel','Papel'),('plastico','Plástico'),('vidro','Vidro'),('metal','Metal'),('eletronicos','Eletrônicos');
