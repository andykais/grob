import { Grobber } from 'https://deno.land/x/grob/mod.ts'


export default class TumblrGrobber extends Grobber {

  @Grobber.register(/https:\/\/tumblr.com\/.*/)
  async post_page(grob, input) {
    const page = await grob.fetch_html(input)
    for (const img of page.select_all('.post img')) {
      await grob.fetch_file(img.attr('href')!)
    }
  }

  @Grobber.register(
    /https:\/\/tumblr.com\/(?<username>.*)/,
    /https:\/\/(?<username>.*)\.tumblr.com/
  )
  async user_page(grob, input, vars) {
    const { username } = groups
    const user_page = await grob.fetch_html(`https://tumblr.com/${username}`)

    for (const post_link of user_page.select_all('.post a')) {
      // launches the grobber
      await this.start(post_link.attr('href')!)
    }
  }
}
