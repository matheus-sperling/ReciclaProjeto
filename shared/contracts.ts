export type Role = "administrador" | "gestor" | "coletor";
export interface Municipio {
  id: string;
  nome: string;
  uf: string;
  ativo: boolean;
  version: number;
}
export interface User {
  id: string;
  nome: string;
  email: string;
  role: Role;
  municipioId: string | null;
  municipio: Municipio | null;
  ativo: boolean;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
}
export interface Morador {
  id: string;
  municipioId: string;
  nome: string;
  bairro: string;
  ativo: boolean;
  version: number;
}
export interface Ponto {
  id: string;
  municipioId: string;
  nome: string;
  local: string;
  lat: number;
  lng: number;
  ativo: boolean;
  version: number;
}
export interface Material {
  id: string;
  nome: string;
}
export interface Catalogo {
  municipio: Municipio;
  moradores: Morador[];
  pontos: Ponto[];
  materiais: Material[];
  atualizadoEm: string;
}
export interface EntregaInput {
  id: string;
  municipioId: string;
  moradorId: string;
  pontoId: string;
  materialId: string;
  kg: number;
  criadoEm: string;
  coletorId: string;
}
export interface Entrega extends EntregaInput {
  moradorNome: string;
  pontoNome: string;
  materialNome: string;
  coletorNome: string;
  recebidoEm?: string;
  status: "pendente" | "sincronizado";
  erroEnvio?: string;
}
export interface Painel {
  municipio: Municipio;
  totalKg: number;
  entregas: number;
  ativos: number;
  pontos: Array<Ponto & { kg: number }>;
  materiais: Array<Material & { kg: number }>;
  atualizadoEm: string;
}
export const roleLabel: Record<Role, string> = {
  administrador: "Administrador da plataforma",
  gestor: "Gestor municipal",
  coletor: "Coletor",
};
