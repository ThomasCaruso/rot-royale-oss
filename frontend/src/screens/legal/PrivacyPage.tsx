import { LegalShell, LegalSection } from "./LegalShell";
import { legalLink } from "./styles";

export function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" lastUpdated="July 30, 2026">
      <p>
        This Privacy Policy explains how Rot Royale ("we," "us") collects, uses,
        and shares information when you use our website, web app, and iOS app
        (the "Service"). By using the Service you agree to this.
      </p>

      <LegalSection heading="Who is responsible for your data">
        <p>
          Rot Royale is operated by <strong>Thomas Caruso</strong>, a sole
          proprietor trading as Rot Royale. Thomas Caruso is the{" "}
          <strong>data controller</strong> for the purposes of the UK and EU
          GDPR — meaning he decides what data is collected and why, and is the
          person legally answerable for it.
        </p>
        <p>
          <strong>Postal address:</strong>
          <br />
          Thomas Caruso, trading as Rot Royale
          <br />
          P.O. Box 6791
          <br />
          Jackson, Wyoming 83001
          <br />
          United States
        </p>
        <p>
          <strong>Contact for any privacy question or request:</strong>{" "}
          <a href="mailto:thomas@webhorizondigital.com" style={legalLink}>
            thomas@webhorizondigital.com
          </a>
          . Email reaches us fastest; the postal address is there so you always
          have a way to reach a real, identifiable person. There is no separate
          Data Protection Officer — the Service does not carry out the kind of
          large-scale monitoring that requires one, so requests go straight to
          the controller.
        </p>
      </LegalSection>

      <LegalSection heading="Information we collect">
        <ul
          style={{
            paddingLeft: 20,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <li>
            <strong>Account information:</strong> if you create an account, the
            email address and display name you provide. Used to identify your
            account, save progress, and contact you.
          </li>
          <li>
            <strong>Gameplay and usage data:</strong> games played, answers,
            scores, streaks, ranks, and progression. This is what makes daily
            play, leaderboards, and ranking work.
          </li>
          <li>
            <strong>Personalization and progress signals:</strong> how you
            interact with questions — your answers, response times, timeouts,
            whether you opened an explanation, and your performance by topic. We
            use these to show your own progress (your Brain Score and "Your
            Growth" trends) and to tailor which practice questions you see.
            These signals never affect ranked scoring, leaderboards, coins, or
            rating.
          </li>
          <li>
            <strong>Notification data:</strong> if you turn on notifications, a
            device push token so we can send reminders (for example, that
            today's game is ending or your streak is at risk). You can turn
            notifications off at any time.
          </li>
          <li>
            <strong>Device and diagnostic data:</strong> device type, OS, app
            version, and crash/error logs, used to keep the Service running and
            fix bugs.
          </li>
          <li>
            <strong>Guest play:</strong> you can start playing without signing
            up. When you do, we create an anonymous account with an
            auto-generated username and no email address, so your streak and
            progress survive. It holds the same gameplay data as a full account.
            If you later save your profile, it becomes your account; if you
            never do, you can still delete it from the app.
          </li>
          <li>
            <strong>IP address:</strong> your IP address reaches our servers
            with every request, as it must for the internet to work. We use it
            transiently to limit abuse (for example, capping how many guest
            accounts can be created from one address per hour). We do not store
            IP addresses in our database and do not use them to build a profile
            of you.
          </li>
          <li>
            <strong>Language preference:</strong> the language you pick is
            stored on your device and sent with requests so we can serve
            questions in that language.
          </li>
        </ul>
        <p>
          Rot Royale collects no payment information; the Service is free with
          no purchases, deposits, withdrawals, or real-money mechanics. We do
          not collect precise location, your contacts, your photos, or biometric
          data, and the app contains no third-party advertising or analytics
          SDKs.
        </p>
      </LegalSection>

      <LegalSection heading="How we use information">
        <ul
          style={{
            paddingLeft: 20,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <li>
            Operate the Service and save your progress, streaks, and ranks.
          </li>
          <li>
            Run daily challenges, practice, battle modes, and leaderboards.
          </li>
          <li>
            Show your progress (your Brain Score and growth trends) and tailor
            practice questions to you.
          </li>
          <li>
            Send notifications you have opted into, such as streak and
            daily-game reminders.
          </li>
          <li>Maintain security, prevent abuse, and diagnose problems.</li>
          <li>Respond to your support requests.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Personalization and your progress profile">
        <p>
          Rot Royale builds a private, per-account progress profile from your
          own play — your Rot Score, your strengths by category, and a learned
          sense of the topics and difficulty you enjoy. We use it to (1) show
          you how you are growing over time and (2) tailor the mix of practice
          questions to you. It is computed on our own servers from your
          gameplay. It is never used to change ranked results or leaderboards,
          and it is not sold or used for advertising. Deleting your account
          removes it.
        </p>
      </LegalSection>

      <LegalSection heading="Artificial intelligence">
        <p>
          <strong>What we use AI for.</strong> We use a third-party AI model for
          two things, both of which operate on{" "}
          <em>our own trivia question bank</em>:
        </p>
        <ul
          style={{
            paddingLeft: 20,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <li>
            <strong>Classifying questions</strong> — rating each question's
            topic, difficulty, and style so we can organize and recommend
            content.
          </li>
          <li>
            <strong>Translating questions</strong> — producing Spanish, French,
            and Turkish versions of our questions and answer options so you can
            play in your language.
          </li>
        </ul>
        <p>
          <strong>What is never sent.</strong> Only question content leaves our
          servers for these purposes. Your personal information, your answers,
          your scores, and your progress profile are never sent to the AI
          provider.
        </p>
        <p>
          <strong>When it runs.</strong> Both processes run offline in batches,
          on our own content, before anyone plays. No AI call happens while you
          are playing, and no AI system sees or scores your gameplay.
        </p>
        <p>
          <strong>No automated decisions about you.</strong> AI is not used to
          make any decision that affects you — it does not set your score, rank,
          rating, coins, or standing, and it is not used for profiling in the
          sense of the GDPR's automated decision-making provisions. Your
          progress profile (described above) is computed by our own servers
          using ordinary arithmetic on your gameplay, not by an AI model.
        </p>
        <p>
          <strong>Provider and location.</strong> Our current AI provider is
          NVIDIA (NVIDIA NIM cloud API), which processes question content in the
          United States. We may change providers; if we do, the limits above
          continue to apply and we will update this policy.
        </p>
        <p>
          <strong>Accuracy.</strong> Machine translation can be imperfect.
          Translated questions are reviewed before being published, and English
          remains the authoritative version of every question. If you spot a
          translation that looks wrong, please tell us.
        </p>
      </LegalSection>

      <LegalSection heading="Notifications">
        <p>
          With your permission, we send push notifications (such as a reminder
          that a game is open or that your streak is about to end). To deliver
          them we store a device push token and route messages through Apple
          Push Notification service on iOS or your browser's push service on the
          web. You can disable notifications at any time in your device settings
          or in the app.
        </p>
      </LegalSection>

      <LegalSection heading="Information other people can see">
        <p>
          Some of what you do in Rot Royale is visible to others by design.
          Please read this section before choosing a username — it is the piece
          of your identity that other people see.
        </p>
        <ul
          style={{
            paddingLeft: 20,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <li>
            <strong>Leaderboards.</strong> Your username, score, rank, division,
            and equipped cosmetics (avatar, frame, badges, title) are shown to
            other people in the same daily field.
          </li>
          <li>
            <strong>Friends and duels.</strong> People can find and add you by
            username. Friends can see your results for the day and your
            head-to-head record with them.
          </li>
          <li>
            <strong>Share links you create.</strong> If you share a result, we
            create a page at a public link containing your username, score, and
            placement.{" "}
            <strong>
              That page can be opened by anyone who has the link, without
              logging in
            </strong>
            , and links may be forwarded or indexed once shared. Only create a
            share link if you are comfortable with that.
          </li>
        </ul>
        <p>
          Your email address is never shown to other users. Deleting your
          account removes your share-link pages.
        </p>
      </LegalSection>

      <LegalSection heading="How we share information">
        <p>
          We do not sell your personal information, we do not share it for
          cross-context behavioral advertising, and we do not share it with data
          brokers. (These are defined terms under California law; we mean them
          in that sense as well as the ordinary one.) We share personal
          information only with:
        </p>
        <ul
          style={{
            paddingLeft: 20,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <li>
            <strong>Hosting and database providers</strong> that run the Service
            on our behalf.
          </li>
          <li>
            <strong>Push-delivery services</strong> (Apple Push Notification
            service on iOS, or your browser's push service on the web) — only if
            you turn notifications on.
          </li>
          <li>
            <strong>Our AI provider</strong> — question content only, never your
            personal information. See "Artificial intelligence" above.
          </li>
          <li>
            <strong>Other users</strong> — as described in "Information other
            people can see".
          </li>
          <li>
            <strong>Law enforcement or others</strong> where required by law, or
            to protect the rights, safety, or security of users or the Service.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Tracking and advertising">
        <p>
          Rot Royale shows no third-party ads and does not track you across
          other companies' apps or websites for advertising.
        </p>
      </LegalSection>

      <LegalSection heading="Data retention">
        <p>
          We keep your account and gameplay data for as long as your account
          exists, because that history <em>is</em> the product — your streak,
          rating, and progress trends are built from it. Specific periods:
        </p>
        <ul
          style={{
            paddingLeft: 20,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <li>
            <strong>
              Account, gameplay, progress, currency, and social data
            </strong>{" "}
            — kept while your account exists. Deleted when you delete your
            account.
          </li>
          <li>
            <strong>Public share links</strong> — stop working when that day's
            Daily Royale closes, and the stored snapshot is deleted
            automatically after that.
          </li>
          <li>
            <strong>Push tokens</strong> — kept while notifications are enabled;
            removed when you turn them off, when your account is deleted, or
            when the push service reports the token is no longer valid.
          </li>
          <li>
            <strong>IP addresses</strong> — never written to our database. Used
            only in memory for abuse limits and discarded within the hour.
          </li>
          <li>
            <strong>Product analytics</strong> — we record which milestones were
            reached (for example "started a game"). When you delete your account
            these are <strong>irreversibly disconnected from you</strong> and
            kept only as anonymous counts with no identifier of any kind.
          </li>
          <li>
            <strong>Server and error logs</strong> — kept up to 30 days for
            security and debugging, then overwritten.
          </li>
          <li>
            <strong>Backups</strong> — deletion removes your data from our live
            database immediately. Our hosting provider also keeps encrypted
            database backups for disaster recovery on a{" "}
            <strong>rolling 3-day cycle</strong>, so a deleted account
            disappears from those backups within 3 days as they are overwritten.
            We never restore deleted data back into the live Service.
          </li>
        </ul>
        <p>
          <strong>Deleting your account is immediate and permanent.</strong> It
          is one action in the app (Profile → Delete account), it does not
          require emailing us, and it removes your account row and everything
          attached to it in the same operation — profile, entries, answers,
          standings, progress profile, skill and preference signals, currency
          history, friendships, duels, campaign progress, cosmetics, push
          tokens, and share links. There is no recovery period and we cannot
          undo it, so please be sure.
        </p>
        <p>
          We may retain limited information for longer only where the law
          requires it, or to resolve a dispute or enforce our Terms — for
          example if we need to keep a record of a ban to stop the same abuse
          recurring.
        </p>
      </LegalSection>

      <LegalSection heading="Why we are allowed to use your data (legal bases)">
        <p>
          If you are in the UK, EU, or EEA, the GDPR requires us to name a legal
          basis for each use:
        </p>
        <ul
          style={{
            paddingLeft: 20,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <li>
            <strong>Performance of a contract</strong> — running your account,
            saving progress, scoring contests, and showing leaderboards. Without
            this data there is no game.
          </li>
          <li>
            <strong>Consent</strong> — push notifications. You opt in, and you
            can withdraw at any time in the app or your device settings;
            withdrawing does not affect anything else.
          </li>
          <li>
            <strong>Legitimate interests</strong> — keeping the Service secure
            and abuse-free (including transient IP-based rate limiting),
            diagnosing faults, and improving the product. We have weighed these
            against your rights and use the least data that works.
          </li>
          <li>
            <strong>Legal obligation</strong> — where we must retain or disclose
            data by law.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Your choices and rights">
        <p>
          You can delete your account yourself at any time:{" "}
          <strong>Profile → Delete account</strong>. That removes your account
          and associated personal data as described under "Data retention".
        </p>
        <p>
          You can <strong>download everything we hold about you</strong> at any
          time, without asking us — the app provides a machine-readable JSON
          export of your account, gameplay history, progress, currency history,
          unlocks, and social records. It excludes other people's data and your
          device push tokens (a token is a credential, so exporting it would
          create a risk without telling you anything useful).
        </p>
        <p>
          You can also ask us to <strong>access</strong>,{" "}
          <strong>correct</strong>, <strong>delete</strong>, or{" "}
          <strong>export</strong> your personal data, to{" "}
          <strong>restrict</strong> or <strong>object to</strong> processing, or
          to <strong>withdraw consent</strong>. Email{" "}
          <a href="mailto:thomas@webhorizondigital.com" style={legalLink}>
            thomas@webhorizondigital.com
          </a>
          . We aim to respond within 30 days. We will never charge you or
          degrade the Service for exercising these rights.
        </p>
        <p>
          <strong>If you are in the UK, EU, or EEA:</strong> you also have the
          right to lodge a complaint with your local data protection supervisory
          authority. You are entitled to do so without contacting us first,
          though we would appreciate the chance to help.
        </p>
        <p>
          <strong>If you are in California:</strong> you have the right to know
          what personal information we collect and how we use it, to delete it,
          to correct it, and to opt out of sale or sharing.{" "}
          <strong>We do not sell or share personal information</strong>, so
          there is no opt-out to exercise. We do not use or disclose sensitive
          personal information beyond what is necessary to provide the Service.
          You may use an authorized agent to make a request.
        </p>
      </LegalSection>

      <LegalSection heading="Where your data is processed">
        <p>
          We operate from the United States and our hosting, database, and AI
          providers process data in the United States. If you use Rot Royale
          from outside the US, your information is transferred there and handled
          under this policy and US law.
        </p>
      </LegalSection>

      <LegalSection heading="Using Rot Royale from outside the United States">
        <p>
          Rot Royale is operated from the United States and your data is stored
          and processed there. If you use the Service from another country, you
          are sending your information to the US, where privacy law differs from
          your own — most relevantly, the US has no single national privacy law
          equivalent to the GDPR.
        </p>
        <p>
          We apply this policy to everyone, wherever you are. The rights
          described below — access, correction, deletion, export, objection —
          are offered to every user, not only to those in a particular country,
          and we do not sell anyone's data.
        </p>
      </LegalSection>

      <LegalSection heading="Children's privacy">
        <p>
          Rot Royale is not directed to children under 13, and we do not
          knowingly collect personal information from anyone under 13. If you
          are in the UK, EU, or EEA, the minimum age is 16 unless your country
          sets a lower one (some set it as low as 13).
        </p>
        <p>
          If we learn that we have collected personal information from a child
          below the applicable age, we will delete the account and its data
          promptly. If you are a parent or guardian and believe your child has
          created an account, email{" "}
          <a href="mailto:thomas@webhorizondigital.com" style={legalLink}>
            thomas@webhorizondigital.com
          </a>{" "}
          and we will remove it.
        </p>
      </LegalSection>

      <LegalSection heading="Security">
        <p>
          We use industry-standard measures including encrypted (HTTPS)
          connections. No method is completely secure, but we work to protect
          your data.
        </p>
      </LegalSection>

      <LegalSection heading="Data breaches">
        <p>
          If a breach affects your personal data and is likely to put your
          rights at risk, we will notify you and the relevant supervisory
          authority as required by law — under the GDPR, within 72 hours of
          becoming aware of it where that obligation applies.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          We may update this policy and will revise the "Last updated" date
          above. If a change materially affects how we handle your personal
          data, we will tell you in the app before it takes effect, and — where
          the law requires consent for the change — we will ask for it rather
          than assume it from continued use.
        </p>
      </LegalSection>

      <p>
        Contact:{" "}
        <a href="mailto:thomas@webhorizondigital.com" style={legalLink}>
          thomas@webhorizondigital.com
        </a>
      </p>
    </LegalShell>
  );
}
