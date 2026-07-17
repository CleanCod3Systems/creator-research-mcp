const profiles = [
  ["youtube", "midudev", "Midudev", "https://www.youtube.com/@midudev"],
  ["instagram", "juanaia_", "Juana IA", "https://www.instagram.com/juanaia_/"],
  ["instagram", "juliacardoso.dev", "Julia Cardoso", "https://www.instagram.com/juliacardoso.dev/"],
  ["instagram", "maxcarrau.ia", "Max Carrau", "https://www.instagram.com/maxcarrau.ia/"],
  ["instagram", "prompteafacil", "Promptea Fácil", "https://www.instagram.com/prompteafacil/"],
  ["youtube", "KokiDuré", "Koki Duré", "https://www.youtube.com/@KokiDur%C3%A9"],
  ["instagram", "kokidure", "Koki Duré", "https://www.instagram.com/kokidure/"],
  ["instagram", "xkokidurex", "Koki Duré", "https://www.instagram.com/xkokidurex/"],
  ["instagram", "viumavaga", "Viumavaga", "https://www.instagram.com/viumavaga/"],
  ["instagram", "michaelcarrillom", "Michael Carrillo", "https://www.instagram.com/michaelcarrillom/"],
  ["instagram", "construyendoia", "Construyendo IA", "https://www.instagram.com/construyendoia/"],
  ["instagram", "miguebaenaia", "Migue Baena IA", "https://www.instagram.com/miguebaenaia/"],
  ["instagram", "marcolamaia", "Marco Lama IA", "https://www.instagram.com/marcolamaia/"],
  ["instagram", "enpixelesmedia", "En Pixeles Media", "https://www.instagram.com/enpixelesmedia/"],
  ["instagram", "juanpablo.rosso", "Juan Pablo Rosso", "https://www.instagram.com/juanpablo.rosso/"],
  ["instagram", "eu.adrian_g.s", "Adrián G.", "https://www.instagram.com/eu.adrian_g.s/"],
  ["instagram", "rocketseat", "Rocketseat", "https://www.instagram.com/rocketseat/"],
];

for (const [platform, handle, name, profileUrl] of profiles) {
  const response = await fetch("http://localhost:3333/api/creators", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform, handle, name, profileUrl }),
  });
  if (!response.ok) throw new Error(`${handle}: ${await response.text()}`);
}
console.log(`Seeded ${profiles.length} profiles`);
