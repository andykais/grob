import { Grobber } from 'https://deno.land/x/grob/mod.ts'


interface Vars {
  username: string
}

const grobber = new Grobber<Vars>()


grobber.register({
  match: /https:\/\/tumblr.com\/post\/.*/,
  fn: async (grob, input) => {
    const page = await grob.fetch_html(input)
    for (const img of page.select_all('.post img')) {
      await grob.fetch_file(img.attr('href')!)
    }
  }
})

grobber.register({
  match: [
    /https:\/\/tumblr.com\/(?<username>.*)/,
    /https:\/\/(?<username>.*)\.tumblr.com/
  ],
  fn: async (grob, input, vars) => {
    console.log('starting page...')
    const { username } = vars
    const user_page = await grob.fetch_html(`https://tumblr.com/${username}`)

    const posts = user_page
      .select_all('div[data-testid="timelinePosts"] > div > div > div > div[data-id]')
      .map(post => post.attr('href'))
    console.log('posts:', posts.length)

    for (const post of posts) {
      // launches the grobber
      // await grob.start(post_link.attr('href')!)
    }
  }
})

export { grobber }
