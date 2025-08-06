import { Grobber } from 'https://deno.land/x/grob/mod.ts'


const grobber = new Grobber()


@grobber.register(/https:\/\/tumblr.com\/.*/)
async function post_page(grob, input) {
  const page = await grob.fetch_html(input)
  for (const img of page.select_all('.post img')) {
    await grob.fetch_file(img.attr('href')!)
  }
}

@grobber.register(
  /https:\/\/tumblr.com\/(?<username>.*)/,
  /https:\/\/(?<username>.*)\.tumblr.com/
)
async function user_page(grob, input, vars) {
  const { username } = groups
  const user_page = await grob.fetch_html(`https://tumblr.com/${username}`)

  for (const post_link of user_page.select_all('.post a')) {
    // launches the grobber
    // await grob.start(post_link.attr('href')!)
  }
}


export { grobber }
