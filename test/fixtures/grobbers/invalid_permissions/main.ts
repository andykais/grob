import { Grob, Grobber } from 'https://deno.land/x/grob/mod.ts'


export const grobber = new Grobber()
grobber.register({
  match: /.*/,
  fn: async (grob: Grob, input: string) => {
    const index_html = await grob.fetch_html(input)
    throw new Error('unexpected code path. This scraper should have failed to fetch')
  }
})
