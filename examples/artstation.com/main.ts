import { Grobber, type Grob } from 'https://deno.land/x/grob/mod.ts'
import * as z from 'npm:zod@3.21'



const UserId = z.coerce.number()

const Posts = z.object({ 
  data: z.object({
    id: z.number(),
    title: z.string(),
    hash_id: z.string(),
  }).array()
})


async function post_page(grob: Grob, input: string) {
  const page = await grob.fetch_html(input + '.json')
  // for (const img of page.select_all('.post img')) {
  //   await grob.fetch_file(img.attr('href')!)
  // }
}

async function user_page(grob: Grob, input: string, vars: { username: string }) {
  const { username } = vars
  console.log({ username })
  const user_page = await grob.fetch_html(`https://artstation.com/${username}`)

  const user_id = UserId.parse(
    user_page.select_one(`script:contains('cacheFactory')`)
    ?.text()
    ?.match(/user_id\\":(\d+)/)
    ?.[1]
  )

  const posts = Posts.parse(
    await grob.fetch_json(`https://www.artstation.com/users/dofresh/projects.json?page=1&user_id=${user_id}`)
  )
  for (const post_data of posts.data) {

    // launches the grobber
    // TODO
    // await grobber.start(`https://artstation.com/artwork/${post_data.hash_id}`)
    await post_page(grob, `https://artstation.com/artwork/${post_data.hash_id}`)
    break
  }
}


export const grobber = new Grobber<{ username: string }>()

grobber
  .register({
    match: /https:\/\/www.artstation.com\/artwork\/.*/,
    fn: post_page,
  })

grobber
  .register({
    match: /https:\/\/artstation.com\/(?<username>[^\/]*)/,
    fn: user_page,
  })
