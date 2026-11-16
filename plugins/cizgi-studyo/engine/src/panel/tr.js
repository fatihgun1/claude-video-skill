// The engine's messages the panel shows most, in Turkish. The engine itself stays English: Claude
// reads the same messages (the approval error even tells Claude what to ask the person), so the
// panel translates them when it shows them, line by line; a line it does not know stays as it is.

const GATES = { senaryo: "Senaryo", storyboard: "Storyboard" };
const KINDS = { background: ["mekânı", "mekân"], prop: ["nesnesi", "nesne"] }; // "Proje mekânı …", "bir mekân"

/** [pattern, Turkish] pairs, tried in order on each line. */
const RULES = [
  // a prefix the panel added ("kaydedilmedi: ", "açılamadı: ") stays in front
  [/^(.*?)gate "(\w+)" has not been approved\..*$/, (_, pre, g) => `${pre}${GATES[g] || g} onayı verilmedi: Claude'a göster, beğenirsen onay ver.`],
  [/^(.*?)gate "(\w+)" was approved, but the content changed since\..*$/, (_, pre, g) => `${pre}${GATES[g] || g} onaylanmıştı ama içerik sonra değişti: yeniden onay gerekir.`],
  [/^project sound effect (\S+): its source is not written in kutuphane\/sfx\/KAYNAKLAR\.md.*$/,
    (_, id) => `Proje efekti ${id}: kaynağı kutuphane/sfx/KAYNAKLAR.md'de yazılı değil (dosya, nereden, lisans).`],
  [/^project sound effect (\S+): the plugin's library already has a sound effect .*$/,
    (_, id) => `Proje efekti ${id}: eklentinin kütüphanesinde aynı adda bir efekt var; başka bir ad ver.`],
  [/^project (background|prop) (\S+): the plugin's library already has a \w+ .*$/,
    (_, kind, id) => `Proje ${KINDS[kind][0]} ${id}: eklentinin kütüphanesinde aynı adda bir ${KINDS[kind][1]} var; başka bir ad ver.`],
  [/^(\S+) exited with (\d+) \(its messages are above\)$/, (_, cmd, code) => `${cmd} hata verdi (çıkış kodu ${code}); ayrıntı yukarıdaki kayıtta.`],
  [/^(\S+) exited with (\d+):$/, (_, cmd, code) => `${cmd} hata verdi (çıkış kodu ${code}):`],
  [/^(.*)EPERM: operation not permitted, rename .*$/, (_, pre) => `${pre}Dosyanın üzerine yazılamadı: başka bir program onu açık tutuyor (EPERM).`],
  [/^(.*?)no 3D recipe for: (.*)$/, (_, pre, list) => `${pre}3B tarifi yok: ${list} (3B önizleme ve render bu karakter ve mekânların library/3d tarifini ister).`],
  [/^(?:character (\S+): )?(#\S+) bends, but (\d+) shape\(s\) in it \(([^)]*)\) do not bend with it and will slide.*$/,
    (_, who, limb, n, kinds) => `${who ? `${who}: ` : ""}${limb} bükülüyor ama içindeki ${n} şekil (${kinds}) onunla bükülmüyor, kayacak: ayrıntıyı gövdeye, ele ya da ayağa çiz ya da çıkar.`],
  [/^(.*?)episode is invalid:$/, (_, pre) => `${pre}Bölümde hata var:`],
];

/** A message (one or more lines) with every line the panel knows in Turkish. */
export function tr(text) {
  return String(text ?? "").split("\n").map((line) => {
    for (const [re, to] of RULES) if (re.test(line)) return line.replace(re, to);
    return line;
  }).join("\n");
}
