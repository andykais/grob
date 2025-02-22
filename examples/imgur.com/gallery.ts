import * as path from '@std/path'
import { Grob, Grobber } from '../../mod.ts'


export const grobber = new Grobber()
grobber.register({
  match: /.*/,

  fn: async function(grob: Grob, input: string) {
    const gallery_page = await grob.fetch_html(input)
    const script_content = gallery_page.select_one("script:contains('postDataJSON')")?.text()
      .replace('window.postDataJSON=', '')
      .replace(/^"/, '')
      .replace(/"$/, '')
      .replace(/\\"/g, '"')
      .replace(/\\\"/g, '\"')
      .replace(/\\'/g, `'`)

    if (!script_content) throw new Error('could not find gallery data')
    const gallery_data = JSON.parse(script_content)

    await Deno.writeTextFile(path.join(grob.download_folder, 'gallery_data.json'), JSON.stringify(gallery_data))

    for (const media of gallery_data.media) {
      const filepath = await grob.fetch_file(media.url)
    }
  }
})
