/** What the founder tells us. Defaults: no company, Android not urgent, no old Play account. */
export interface RouteAnswers {
  company: boolean;
  androidNow?: boolean;
  playAccountBefore20231113?: boolean;
}

export type AccountType = "organization" | "personal" | "individual";

export interface RouteStep {
  /** Stable id, used by `shipvo store status --mark <id>`. */
  id: string;
  title: string;
  /** What the founder does. */
  action: string;
  /** Set when the step is a wait the founder cannot speed up. */
  wait?: string;
}

export interface StoreRoute {
  account: AccountType;
  accountNote: string;
  /** True only for a Google Play personal account made after 13 Nov 2023. */
  testerRule: boolean;
  steps: RouteStep[];
  waits: string[];
}

export interface StoreRoutes {
  answers: Required<RouteAnswers>;
  play: StoreRoute;
  apple: StoreRoute;
  notes: string[];
}

/** The community Google Group for the tester rule. Anyone can join; members cannot see each other's emails; only managers post. */
export const SHIPVO_TESTERS_GROUP = "shipvo-testers@googlegroups.com";
export const SHIPVO_TESTERS_JOIN_URL = "https://groups.google.com/g/shipvo-testers";
export const SHIPVO_TESTERS_SHORT_URL = "https://shipvo.dev/testers";

export const TESTER_RULE = "Google Play needs at least 12 testers opted in to a closed test for 14 days in a row before you can apply for production.";

function play(a: Required<RouteAnswers>): StoreRoute {
  if (a.company) {
    return {
      account: "organization", testerRule: false,
      accountNote: "Organization account. The tester rule does not apply.",
      steps: [
        { id: "play-account", title: "Open a Google Play organization account", action: "Register at play.google.com/console with your company details. You need a D-U-N-S number.", wait: "Google verifies the organization; this can take days." },
        { id: "play-upload", title: "Upload your first release", action: "Upload the build and fill in the store listing and forms." },
        { id: "play-review", title: "Production review", action: "Send the release to production.", wait: "Google review." },
        { id: "play-live", title: "Live on Google Play", action: "Check the listing is public." },
      ],
      waits: ["Account verification", "Google review"],
    };
  }
  if (a.playAccountBefore20231113) {
    return {
      account: "personal", testerRule: false,
      accountNote: "Personal account made before 13 Nov 2023. It is exempt from the tester rule.",
      steps: [
        { id: "play-account", title: "Use your existing Google Play account", action: "Sign in to Play Console and confirm the account is still in good standing." },
        { id: "play-upload", title: "Upload your first release", action: "Upload the build and fill in the store listing and forms." },
        { id: "play-review", title: "Production review", action: "Send the release to production.", wait: "Google review." },
        { id: "play-live", title: "Live on Google Play", action: "Check the listing is public." },
      ],
      waits: ["Google review"],
    };
  }
  return {
    account: "personal", testerRule: true,
    accountNote: "Personal account (25 USD once). " + TESTER_RULE,
    steps: [
      { id: "play-account", title: "Open a Google Play personal account", action: "Register at play.google.com/console and pay the 25 USD fee.", wait: "Identity verification." },
      { id: "play-closed-test", title: "Start the closed test with 12 testers", action: `Upload a build to the closed track and get 12 real people to opt in. Start on day one. Add your own testers and the Shipvo Testers group (${SHIPVO_TESTERS_GROUP}) as Google Groups on the closed track, and share your opt-in link. Join Shipvo Testers yourself (${SHIPVO_TESTERS_SHORT_URL}) to test other founders' apps: the community works because everyone tests.`, wait: "14 days in a row with at least 12 testers. If the count drops below 12 the clock resets." },
      { id: "play-apply", title: "Apply for production access", action: "Answer Google's questions about your test and apply." },
      { id: "play-review", title: "Production review", action: "Wait for Google to approve production, then release.", wait: "Google review, up to about 7 days." },
      { id: "play-live", title: "Live on Google Play", action: "Check the listing is public." },
    ],
    waits: ["14 days of closed testing", "Google review, up to about 7 days"],
  };
}

function apple(a: Required<RouteAnswers>): StoreRoute {
  const tail: RouteStep[] = [
    { id: "apple-submit", title: "Submit to App Store review", action: "Upload the build to App Store Connect and submit when ready. Apple has no tester rule." },
    { id: "apple-review", title: "App Store review", action: "Answer any reviewer questions.", wait: "Apple review." },
    { id: "apple-live", title: "Live on the App Store", action: "Check the listing is public." },
  ];
  if (a.company) {
    return {
      account: "organization", testerRule: false,
      accountNote: "Organization account (needs a D-U-N-S number).",
      steps: [{ id: "apple-account", title: "Open an Apple Developer organization account", action: "Get a free D-U-N-S number, then enrol at developer.apple.com (99 USD a year).", wait: "Apple verifies the organization; this can take days." }, ...tail],
      waits: ["Account verification", "Apple review"],
    };
  }
  return {
    account: "individual", testerRule: false,
    accountNote: "Individual account (99 USD a year).",
    steps: [{ id: "apple-account", title: "Open an Apple Developer individual account", action: "Enrol at developer.apple.com (99 USD a year).", wait: "Apple verifies identity." }, ...tail],
    waits: ["Account verification", "Apple review"],
  };
}

/** Pick the account type, next steps and waits for each store. Pure; no store calls. */
export function routeStore(answers: RouteAnswers): StoreRoutes {
  const a: Required<RouteAnswers> = {
    company: answers.company === true,
    androidNow: answers.androidNow === true,
    playAccountBefore20231113: answers.playAccountBefore20231113 === true,
  };
  const notes: string[] = [];
  if (!a.company && a.androidNow && !a.playAccountBefore20231113) {
    notes.push("There is no faster Android route yet. Start the closed test on day one, and ship iOS first.");
  }
  if (!a.company) notes.push("When you have a company, register it and get a free D-U-N-S number. Nothing here waits for that.");
  return { answers: a, play: play(a), apple: apple(a), notes };
}
