import { Grobber } from 'https://deno.land/x/grob/mod.ts'


export default new Grobber()
.register(
  match: [/https:\/\/tumblr.com\/.*/],
  fn: async (grob, input) => {
    const page = await grob.fetch_html(input)
    for (const img of page.select_all('.post img')) {
      await grob.fetch_file(img.attr('href')!)
    }
  }
)
.register(
  match: [
    /https:\/\/tumblr.com\/(?<username>.*)/,
    /https:\/\/(?<username>.*)\.tumblr.com/
  ],
  async fn: (grob, input, vars) => {
    const { username } = groups
    const user_page = await grob.fetch_html(`https://tumblr.com/${username}`)

    for (const post_link of user_page.select_all('.post a')) {
      // launches the grobber
      // await grob.start(post_link.attr('href')!)
    }
  }
}
