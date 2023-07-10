import type { Handlers, PageProps } from "$fresh/server.ts";
import { Head } from "$fresh/runtime.ts";
import { useSignal } from "@preact/signals";

interface GrobSchedulerProps {
  grob_input: string | undefined
  matched_grobber?: {}
}

export const handler: Handlers<GrobSchedulerProps> = {
  GET(req, ctx) {
    const url = new URL(req.url);
    const grob_input = url.searchParams.get("grob_input") ?? undefined
    // const results = NAMES.filter((name) => name.includes(query));
    return ctx.render({ grob_input });
  },
};


export default function Home({ data }: PageProps<GrobSchedulerProps>) {
  return (
    <>
      <Head>
        <title>Grob Scheduler</title>
      </Head>

      <div class="flex gap-2 w-full">
        <form class="w-full">
          <input
            class="flex w-full"
            type="text"
            name="grob_input"
            placeholder="grob input to match against..."
            value={data.grob_input} 
            />
        </form>
      </div>
    </>
  );
}
