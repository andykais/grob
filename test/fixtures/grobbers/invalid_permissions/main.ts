import { Grob } from 'https://deno.land/x/grob/mod.ts'


export default async function(grob: Grob, input: string) {
  const index_html = await grob.fetch_html(input)
  throw new Error('unexpected code path. This scraper should have failed to fetch')
}
