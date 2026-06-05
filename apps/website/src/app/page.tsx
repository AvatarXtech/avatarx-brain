import Navbar from "../components/Navbar";

export default function Home() {
  return (
    <main className="min-h-screen bg-[#EEF1F4] text-zinc-900">
      <Navbar />

      <section className="mx-auto max-w-7xl px-8 pb-40 pt-32">
        <div className="mb-8 text-sm uppercase tracking-[0.4em] text-orange-500">
          Artificial Intelligence \& Cognitive Infrastructure
        </div>

        <h1 className="max-w-6xl text-6xl font-semibold leading-none md:text-[130px]">
          AvatarNeuron
        </h1>

        <p className="mt-10 max-w-4xl text-2xl leading-relaxed text-zinc-600">
          The Intelligence Layer
          <br />
          For Digital Experiences.
        </p>

        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-zinc-500">
          Powering analytics, recommendations, behavioral intelligence,
          audience understanding, AI systems, and adaptive experiences
          across the Meta Avatar ecosystem.
        </p>

        <div className="mt-14 flex flex-wrap gap-4">
          <button className="rounded-md bg-orange-500 px-6 py-3 font-medium text-white">
            Explore Platform
          </button>

          <button className="rounded-md border border-zinc-300 px-6 py-3 font-medium">
            Intelligence Overview
          </button>
        </div>
      </section>

      <section className="border-t border-zinc-200">
        <div className="mx-auto max-w-6xl px-8 py-32">
          <h2 className="max-w-4xl text-5xl font-semibold leading-tight">
            Building The Synthetic Brain
          </h2>

          <p className="mt-10 max-w-4xl text-xl leading-relaxed text-zinc-600">
            AvatarNeuron serves as the intelligence infrastructure powering
            personalized experiences, predictive insights, audience analytics,
            recommendation systems, avatar cognition, and ecosystem-wide
            intelligence across immersive digital environments.
          </p>
        </div>
      </section>

      <section className="border-t border-zinc-200">
        <div className="mx-auto max-w-7xl px-8 py-32">
          <h2 className="mb-20 text-5xl font-semibold">
            Cognitive Capabilities
          </h2>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="rounded-2xl border border-zinc-200 bg-white/60 p-8">
              <h3 className="text-xl font-medium">
                Behavioral Intelligence
              </h3>

              <p className="mt-4 text-zinc-500">
                Understand participation, engagement, and interaction patterns.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/60 p-8">
              <h3 className="text-xl font-medium">
                Recommendation Systems
              </h3>

              <p className="mt-4 text-zinc-500">
                Deliver personalized content and immersive experiences.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/60 p-8">
              <h3 className="text-xl font-medium">
                Predictive Analytics
              </h3>

              <p className="mt-4 text-zinc-500">
                Anticipate audience behavior and optimize engagement.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* INTELLIGENCE ARCHITECTURE */}

      <section className="border-t border-zinc-200">
        <div className="mx-auto max-w-7xl px-8 py-32 text-center">

          <h2 className="mb-20 text-5xl font-semibold">
            Intelligence Architecture
          </h2>

          <div className="inline-block rounded-xl border border-zinc-300 bg-white/60 px-8 py-4 text-2xl font-medium">
            Data & Interactions
          </div>

          <div className="my-6 text-zinc-400">↓</div>

          <div className="rounded-3xl border-2 border-orange-400 bg-white/80 px-12 py-10">
            <div className="text-4xl font-semibold text-orange-500">
              AvatarNeuron
            </div>

            <div className="mt-4 text-zinc-600">
              Ecosystem Intelligence & Cognitive Infrastructure
            </div>
          </div>

          <div className="my-6 text-zinc-400">↓</div>

          <div className="grid gap-6 md:grid-cols-3">
            <div className="rounded-xl border border-zinc-200 bg-white/60 p-6">
              Audience Analytics
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white/60 p-6">
              Recommendations
            </div>

            <div className="rounded-xl border border-zinc-200 bg-white/60 p-6">
              Avatar Cognition
            </div>
          </div>

        </div>
      </section>

      
      {/* METRICS */}

      <section className="border-t border-zinc-200">
        <div className="mx-auto max-w-7xl px-8 py-24">

          <div className="grid gap-10 text-center md:grid-cols-4">

            <div>
              <div className="text-5xl font-semibold">AI</div>
              <div className="mt-2 text-zinc-500">
                Intelligence Systems
              </div>
            </div>

            <div>
              <div className="text-5xl font-semibold">ML</div>
              <div className="mt-2 text-zinc-500">
                Machine Learning
              </div>
            </div>

            <div>
              <div className="text-5xl font-semibold">CX</div>
              <div className="mt-2 text-zinc-500">
                Experience Intelligence
              </div>
            </div>

            <div>
              <div className="text-5xl font-semibold">BI</div>
              <div className="mt-2 text-zinc-500">
                Behavioral Analytics
              </div>
            </div>

          </div>

        </div>
      </section>



      {/* INTELLIGENCE STACK */}

      <section className="border-t border-zinc-200">
        <div className="mx-auto max-w-7xl px-8 py-32">

          <h2 className="mb-20 text-5xl font-semibold">
            Core Intelligence Stack
          </h2>

          <div className="grid gap-8 md:grid-cols-4">

            <div className="rounded-2xl border border-zinc-200 bg-white/70 p-8">
              <div className="mb-4 text-orange-500">01</div>
              <h3 className="font-medium">Perception</h3>
              <p className="mt-3 text-sm text-zinc-500">
                Understand interactions, behavior, and signals.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/70 p-8">
              <div className="mb-4 text-orange-500">02</div>
              <h3 className="font-medium">Learning</h3>
              <p className="mt-3 text-sm text-zinc-500">
                Continuously improve through ecosystem data.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/70 p-8">
              <div className="mb-4 text-orange-500">03</div>
              <h3 className="font-medium">Reasoning</h3>
              <p className="mt-3 text-sm text-zinc-500">
                Generate insights, predictions, and decisions.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/70 p-8">
              <div className="mb-4 text-orange-500">04</div>
              <h3 className="font-medium">Adaptation</h3>
              <p className="mt-3 text-sm text-zinc-500">
                Personalize experiences in real time.
              </p>
            </div>

          </div>

        </div>
      </section>


      {/* SCREENSPLAYER */}

      <section className="border-t border-zinc-200">
        <div className="mx-auto max-w-7xl px-8 py-32">

          <h2 className="mb-16 text-5xl font-semibold">
            Applications Across Screensplayer
          </h2>

          <div className="grid gap-8 md:grid-cols-3">

            <div className="rounded-2xl border border-zinc-200 bg-white/60 p-8">
              <h3 className="text-xl font-medium">
                Audience Intelligence
              </h3>

              <p className="mt-4 text-zinc-500">
                Understand viewer behavior, participation trends,
                and engagement signals.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/60 p-8">
              <h3 className="text-xl font-medium">
                Personalized Discovery
              </h3>

              <p className="mt-4 text-zinc-500">
                Deliver relevant content, experiences,
                and recommendations.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/60 p-8">
              <h3 className="text-xl font-medium">
                Adaptive Experiences
              </h3>

              <p className="mt-4 text-zinc-500">
                Power intelligent and responsive immersive environments.
              </p>
            </div>

          </div>

        </div>
      </section>


      {/* BUSINESS OUTCOMES */}

      <section className="border-t border-zinc-200">
        <div className="mx-auto max-w-7xl px-8 py-32">

          <h2 className="mb-20 text-5xl font-semibold">
            Business Outcomes
          </h2>

          <div className="grid gap-8 md:grid-cols-2">

            <div className="rounded-2xl border border-zinc-200 bg-white/70 p-10">
              <h3 className="text-2xl font-medium">
                Increased Engagement
              </h3>

              <p className="mt-4 text-zinc-500">
                Deliver highly relevant experiences through personalization,
                intelligent recommendations, and adaptive interactions.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/70 p-10">
              <h3 className="text-2xl font-medium">
                Actionable Intelligence
              </h3>

              <p className="mt-4 text-zinc-500">
                Transform ecosystem activity into meaningful insights,
                predictive analytics, and strategic decision support.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/70 p-10">
              <h3 className="text-2xl font-medium">
                Adaptive Experiences
              </h3>

              <p className="mt-4 text-zinc-500">
                Enable experiences that continuously evolve based on
                audience behavior and contextual intelligence.
              </p>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/70 p-10">
              <h3 className="text-2xl font-medium">
                Ecosystem Optimization
              </h3>

              <p className="mt-4 text-zinc-500">
                Connect analytics, recommendations, and cognition into
                a unified intelligence framework across products.
              </p>
            </div>

          </div>

        </div>
      </section>


      {/* CLOSING */}

      <section className="border-t border-zinc-200">
        <div className="mx-auto max-w-6xl px-8 py-40 text-center">

          <h2 className="text-6xl font-semibold leading-tight md:text-7xl">
            Intelligence For
            <br />
            The Next Generation
            <br />
            Of Digital Experiences.
          </h2>

        </div>
      </section>

      {/* FOOTER */}

      <footer className="border-t border-zinc-200">
        <div className="mx-auto max-w-7xl px-8 py-20">

          <div className="flex items-center justify-between">

            <div>
              <div className="text-xl font-semibold">
                AvatarNeuron
              </div>

              <div className="mt-2 text-zinc-500">
                Artificial Intelligence \& Cognitive Infrastructure
              </div>
            </div>

            <div className="text-sm text-zinc-500">
              © 2026 Meta Avatar Lab
            </div>

          </div>

        </div>
      </footer>

    </main>
  );
}
