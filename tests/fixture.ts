import type { User } from "../shared/contracts";
export const ids = {
  a: "11111111-1111-4111-8111-111111111111",
  b: "22222222-2222-4222-8222-222222222222",
  ga: "33333333-3333-4333-8333-333333333333",
  gb: "44444444-4444-4444-8444-444444444444",
  ca: "55555555-5555-4555-8555-555555555555",
  cb: "66666666-6666-4666-8666-666666666666",
  ra: "77777777-7777-4777-8777-777777777777",
  rb: "88888888-8888-4888-8888-888888888888",
  pa: "99999999-9999-4999-8999-999999999999",
  pb: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  admin: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};
export const testPassword = "Teste-local-frase-2026!";
export function actor(
  role: "gestor" | "coletor" | "administrador",
  city: "a" | "b" = "a",
): User {
  return {
    id:
      role === "administrador"
        ? ids.admin
        : ids[
            ((role === "gestor" ? "g" : "c") + city) as
              "ga" | "gb" | "ca" | "cb"
          ],
    nome:
      role === "administrador"
        ? "Administrador"
        : role === "gestor"
          ? "Gestor " + city
          : "Coletor " + city,
    email: role + "-" + city + "@teste.invalid",
    role,
    municipioId: role === "administrador" ? null : ids[city],
    municipio:
      role === "administrador"
        ? null
        : {
            id: ids[city],
            nome: city === "a" ? "Coxim" : "Campo Grande",
            uf: "MS",
            ativo: true,
            version: 1,
          },
    ativo: true,
    mustChangePassword: false,
    twoFactorEnabled: role === "administrador",
  };
}
