import * as path from 'https://deno.land/std@0.192.0/path/mod.ts'
import { Grob } from 'https://deno.land/x/grob/mod.ts'
import * as util from './util.ts'


export default async function(grob: Grob, input: string) {
  const params = new URL(input).searchParams
  const a = parseInt(params.get('a'))
  const b = parseInt(params.get('b'))
  const result = util.add(a, b)

  const data = { a, b, result }
  await Deno.writeTextFile(path.join(grob.download_folder, 'add.json'), JSON.stringify(data))
}
