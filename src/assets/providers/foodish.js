import { fetchJson } from '../../util/http.js'

const CATEGORY_RULES = [
  { when: /pasta|espagueti|lasaña|macarr/i, category: 'pasta' },
  { when: /pizza/i, category: 'pizza' },
  { when: /arroz|risotto|paella/i, category: 'rice' },
  { when: /postre|tarta|chocolate|helado|dulce/i, category: 'dessert' },
  { when: /hamburguesa|burger/i, category: 'burger' },
  { when: /pollo|curry/i, category: 'butter-chicken' },
]

/**
 * Imagen gastronómica genérica del repositorio libre Foodish (sin clave).
 * No busca por ingrediente: sirve como último recurso temático.
 * @param {string} query
 */
export async function searchFoodish(query) {
  const rule = CATEGORY_RULES.find((entry) => entry.when.test(query))
  const category = rule?.category ?? 'pasta'
  const data = await fetchJson(`https://foodish-api.com/api/images/${encodeURIComponent(category)}`, { timeoutMs: 12000, retries: 1 })
  if (!data?.image) return []
  return [{
    provider: 'foodish',
    title: `Foodish ${category}`,
    url: data.image,
    originalUrl: data.image,
    width: 1080,
    height: 1080,
    license: 'Foodish (uso libre)',
    author: 'Foodish API',
    pageUrl: 'https://foodish-api.com/',
  }]
}
