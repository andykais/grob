import * as path from '@std/path'
import { Grob, Grobber } from 'http://localhost:9000/jsr/@andykais/grob'
import * as util from './util.ts'


export const grobber = new Grobber()

grobber.register({
  match: /.*/,
  fn: async (grob: Grob, input: string) => {
    const params = new URL(input).searchParams
    const a = parseInt(params.get('a'))
    const b = parseInt(params.get('b'))
    const result = util.add(a, b)

    const data = { a, b, result }
    await Deno.writeTextFile(path.join(grob.download_folder, 'add.json'), JSON.stringify(data))
  }
})
