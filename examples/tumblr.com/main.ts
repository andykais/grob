import { Grobber } from 'https://deno.land/x/grob/mod.ts'


export const grobber = new Grobber()


grobber.register(/https:\/\/tumblr.com\/.*/)
async function post_page(grob: Grob, input: string) {
  const page = await grob.fetch_html(input)
  for (const img of page.select_all('.post img')) {
    await grob.fetch_file(img.attr('href'))
  }
}

grobber.register(
  /https:\/\/tumblr.com\/(?<username>.*)/,
  /https:\/\/(?<username>.*)\.tumblr.com/
)
async function user_page(grob: Grob, input: string, groups: {username: string}) {
  const { username } = groups
  const user_page = await grob.fetch_html(`https://tumblr.com/${username}`)

  for (const post_link of user_page) {
    // launches the grobber
    await grob.start(input)
  }
}
