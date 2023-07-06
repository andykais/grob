import * as path from 'https://deno.land/std@0.192.0/path/mod.ts'
import { Grob } from '../../src/grob.ts'


export default async function(grob: Grob, input: string) {
  const gallery_page = await grob.fetch_html('https://imgur.com/gallery/NTwmL')
  const script_content = gallery_page.one("script:contains('postDataJSON')")?.text()
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
