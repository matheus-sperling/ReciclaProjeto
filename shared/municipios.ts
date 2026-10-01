// IBGE, Localidades do Brasil 2022: sedes municipais de MS (SIRGAS 2000).
// Fonte e procedimento de atualização: docs/OPERACAO.md.
export interface SedeMunicipal {
  ibge: string;
  nome: string;
  lat: number;
  lng: number;
}
export const municipiosMS: readonly SedeMunicipal[] = [
  { ibge: "5000252", nome: "Alcinópolis", lat: -18.3288, lng: -53.713501 },
  { ibge: "5000609", nome: "Amambai", lat: -23.105499, lng: -55.231701 },
  { ibge: "5000708", nome: "Anastácio", lat: -20.4842, lng: -55.805599 },
  { ibge: "5000807", nome: "Anaurilândia", lat: -22.183001, lng: -52.720299 },
  { ibge: "5000856", nome: "Angélica", lat: -22.158899, lng: -53.771801 },
  { ibge: "5000906", nome: "Antônio João", lat: -22.1947, lng: -55.948101 },
  {
    ibge: "5001003",
    nome: "Aparecida do Taboado",
    lat: -20.0868,
    lng: -51.102402,
  },
  { ibge: "5001102", nome: "Aquidauana", lat: -20.459299, lng: -55.7813 },
  { ibge: "5001243", nome: "Aral Moreira", lat: -22.947901, lng: -55.630798 },
  { ibge: "5001508", nome: "Bandeirantes", lat: -19.92, lng: -54.362701 },
  { ibge: "5001904", nome: "Bataguassu", lat: -21.718599, lng: -52.4217 },
  { ibge: "5002001", nome: "Batayporã", lat: -22.2955, lng: -53.2672 },
  { ibge: "5002100", nome: "Bela Vista", lat: -22.1057, lng: -56.5355 },
  { ibge: "5002159", nome: "Bodoquena", lat: -20.552601, lng: -56.677299 },
  { ibge: "5002209", nome: "Bonito", lat: -21.127701, lng: -56.487202 },
  { ibge: "5002308", nome: "Brasilândia", lat: -21.247101, lng: -52.036301 },
  { ibge: "5002407", nome: "Caarapó", lat: -22.6348, lng: -54.8241 },
  { ibge: "5002605", nome: "Camapuã", lat: -19.5336, lng: -54.041698 },
  { ibge: "5002704", nome: "Campo Grande", lat: -20.462601, lng: -54.608601 },
  { ibge: "5002803", nome: "Caracol", lat: -22.018, lng: -57.028801 },
  { ibge: "5002902", nome: "Cassilândia", lat: -19.1133, lng: -51.733299 },
  { ibge: "5002951", nome: "Chapadão do Sul", lat: -18.797199, lng: -52.6194 },
  { ibge: "5003108", nome: "Corguinho", lat: -19.833401, lng: -54.828999 },
  { ibge: "5003157", nome: "Coronel Sapucaia", lat: -23.2764, lng: -55.541302 },
  { ibge: "5003207", nome: "Corumbá", lat: -19.0058, lng: -57.674599 },
  { ibge: "5003256", nome: "Costa Rica", lat: -18.544901, lng: -53.132999 },
  { ibge: "5003306", nome: "Coxim", lat: -18.5033, lng: -54.760601 },
  { ibge: "5003454", nome: "Deodápolis", lat: -22.2752, lng: -54.164299 },
  {
    ibge: "5003488",
    nome: "Dois Irmãos do Buriti",
    lat: -20.691299,
    lng: -55.286499,
  },
  { ibge: "5003504", nome: "Douradina", lat: -22.041201, lng: -54.610699 },
  { ibge: "5003702", nome: "Dourados", lat: -22.240999, lng: -54.7831 },
  { ibge: "5003751", nome: "Eldorado", lat: -23.7862, lng: -54.2873 },
  { ibge: "5003900", nome: "Figueirão", lat: -18.6752, lng: -53.641701 },
  { ibge: "5003801", nome: "Fátima do Sul", lat: -22.387899, lng: -54.516701 },
  {
    ibge: "5004007",
    nome: "Glória de Dourados",
    lat: -22.4083,
    lng: -54.234402,
  },
  {
    ibge: "5004106",
    nome: "Guia Lopes da Laguna",
    lat: -21.455799,
    lng: -56.1082,
  },
  { ibge: "5004304", nome: "Iguatemi", lat: -23.684299, lng: -54.562698 },
  { ibge: "5004403", nome: "Inocência", lat: -19.7288, lng: -51.9296 },
  { ibge: "5004502", nome: "Itaporã", lat: -22.0823, lng: -54.787102 },
  { ibge: "5004601", nome: "Itaquiraí", lat: -23.4846, lng: -54.1824 },
  { ibge: "5004700", nome: "Ivinhema", lat: -22.3069, lng: -53.8302 },
  { ibge: "5004809", nome: "Japorã", lat: -23.8941, lng: -54.4035 },
  { ibge: "5004908", nome: "Jaraguari", lat: -20.101999, lng: -54.436798 },
  { ibge: "5005004", nome: "Jardim", lat: -21.4809, lng: -56.1399 },
  { ibge: "5005103", nome: "Jateí", lat: -22.4804, lng: -54.306801 },
  { ibge: "5005152", nome: "Juti", lat: -22.8608, lng: -54.606899 },
  { ibge: "5005202", nome: "Ladário", lat: -19.0063, lng: -57.611301 },
  { ibge: "5005251", nome: "Laguna Carapã", lat: -22.554399, lng: -55.1492 },
  { ibge: "5005400", nome: "Maracaju", lat: -21.621799, lng: -55.1563 },
  { ibge: "5005608", nome: "Miranda", lat: -20.239599, lng: -56.3862 },
  { ibge: "5005681", nome: "Mundo Novo", lat: -23.937401, lng: -54.2785 },
  { ibge: "5005707", nome: "Naviraí", lat: -23.062901, lng: -54.201801 },
  { ibge: "5005806", nome: "Nioaque", lat: -21.158899, lng: -55.831402 },
  {
    ibge: "5006002",
    nome: "Nova Alvorada do Sul",
    lat: -21.4666,
    lng: -54.382801,
  },
  { ibge: "5006200", nome: "Nova Andradina", lat: -22.242399, lng: -53.343399 },
  {
    ibge: "5006259",
    nome: "Novo Horizonte do Sul",
    lat: -22.656099,
    lng: -53.860001,
  },
  { ibge: "5006309", nome: "Paranaíba", lat: -19.677299, lng: -51.198601 },
  { ibge: "5006358", nome: "Paranhos", lat: -23.889601, lng: -55.429901 },
  {
    ibge: "5006275",
    nome: "Paraíso das Águas",
    lat: -19.021799,
    lng: -53.010899,
  },
  { ibge: "5006408", nome: "Pedro Gomes", lat: -18.100599, lng: -54.555099 },
  { ibge: "5006606", nome: "Ponta Porã", lat: -22.5385, lng: -55.724602 },
  { ibge: "5006903", nome: "Porto Murtinho", lat: -21.697901, lng: -57.888901 },
  {
    ibge: "5007109",
    nome: "Ribas do Rio Pardo",
    lat: -20.444099,
    lng: -53.7561,
  },
  { ibge: "5007208", nome: "Rio Brilhante", lat: -21.8016, lng: -54.542801 },
  { ibge: "5007307", nome: "Rio Negro", lat: -19.448999, lng: -54.988499 },
  {
    ibge: "5007406",
    nome: "Rio Verde de Mato Grosso",
    lat: -18.917999,
    lng: -54.840599,
  },
  { ibge: "5007505", nome: "Rochedo", lat: -19.961901, lng: -54.892799 },
  {
    ibge: "5007554",
    nome: "Santa Rita do Pardo",
    lat: -21.305599,
    lng: -52.821201,
  },
  { ibge: "5007802", nome: "Selvíria", lat: -20.3643, lng: -51.423901 },
  { ibge: "5007703", nome: "Sete Quedas", lat: -23.979099, lng: -55.040699 },
  { ibge: "5007901", nome: "Sidrolândia", lat: -20.931999, lng: -54.960602 },
  { ibge: "5007935", nome: "Sonora", lat: -17.5879, lng: -54.752899 },
  {
    ibge: "5007695",
    nome: "São Gabriel do Oeste",
    lat: -19.403099,
    lng: -54.577202,
  },
  { ibge: "5007950", nome: "Tacuru", lat: -23.6404, lng: -55.018902 },
  { ibge: "5007976", nome: "Taquarussu", lat: -22.4869, lng: -53.3503 },
  { ibge: "5008008", nome: "Terenos", lat: -20.4405, lng: -54.865002 },
  { ibge: "5008305", nome: "Três Lagoas", lat: -20.7911, lng: -51.7089 },
  { ibge: "5008404", nome: "Vicentina", lat: -22.4109, lng: -54.440498 },
  { ibge: "5000203", nome: "Água Clara", lat: -20.4431, lng: -52.883202 },
];
export function normalizarMunicipio(nome: string) {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
export function sedeMunicipal(nome: string, uf = "MS") {
  if (uf !== "MS") return undefined;
  const normalized = normalizarMunicipio(nome);
  return municipiosMS.find((c) => normalizarMunicipio(c.nome) === normalized);
}
