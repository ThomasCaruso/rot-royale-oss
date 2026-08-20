import { LegalShell, LegalSection } from "./LegalShell";
import { legalLink } from "./styles";

export function TermsPage() {
  return (
    <LegalShell title="Terms of Use" lastUpdated="July 30, 2026">
      <p>
        These Terms are an agreement between you and{" "}
        <strong>Thomas Caruso</strong>, a sole proprietor trading as Rot Royale
        ("Rot Royale," "we," "us"), and govern your use of the Rot Royale
        website, web app, and iOS app (the "Service"). By using the Service you
        agree to them.
      </p>

      <LegalSection heading="Who you are contracting with">
        <p>
          Thomas Caruso, trading as Rot Royale
          <br />
          P.O. Box 6791
          <br />
          Jackson, Wyoming 83001
          <br />
          United States
          <br />
          <a href="mailto:thomas@webhorizondigital.com" style={legalLink}>
            thomas@webhorizondigital.com
          </a>
        </p>
        <p>
          This is the address for any formal notice under these Terms, including
          the arbitration notice and opt-out described below. Email is the
          fastest way to reach us for everything else.
        </p>
      </LegalSection>

      <LegalSection heading="Eligibility">
        <p>You must be at least 13 years old to use the Service.</p>
        <p>
          Rot Royale is operated from the United States. If you use it from
          another country you do so on your own initiative and are responsible
          for complying with your local law, and your data is processed in the
          US as described in our Privacy Policy.
        </p>
      </LegalSection>

      <LegalSection heading="Your account">
        <p>
          You're responsible for activity under your account and for keeping
          your credentials secure. Don't share your account or impersonate
          anyone. Notify{" "}
          <a href="mailto:thomas@webhorizondigital.com" style={legalLink}>
            thomas@webhorizondigital.com
          </a>{" "}
          if your account is compromised.
        </p>
      </LegalSection>

      <LegalSection heading="License">
        <p>
          We grant you a personal, non-exclusive, non-transferable, revocable
          license to use the Service for your own non-commercial entertainment.
          You may not copy, modify, reverse-engineer, resell, or build a
          competing product from it.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <p>
          Don't cheat, automate, or exploit the Service; don't disrupt or breach
          its security; don't use it unlawfully or abusively.
        </p>
      </LegalSection>

      <LegalSection heading="Personalization and notifications">
        <p>
          The Service personalizes your practice questions and shows your
          progress based on how you play; this never affects ranked results.
          Optional push notifications (such as game and streak reminders) can be
          turned on or off at any time. See our Privacy Policy for details on
          the information involved.
        </p>
      </LegalSection>

      <LegalSection heading="Virtual items and virtual currency">
        <p>
          Coins, Gems, ranks, streaks, cosmetics, and rewards are{" "}
          <strong>virtual items</strong>. They are a limited, personal,
          non-transferable, revocable licence to use a feature of the Service —
          you do not own them as property.
        </p>
        <p>
          <strong>They have no monetary value.</strong> Virtual items cannot be
          exchanged for money, sold, traded, transferred between accounts, or
          withdrawn, and they have no value outside the Service. Rot Royale has
          no real-money wagering, gambling, cash prizes, deposits, or
          withdrawals. Rankings are decided by skill, never by anything you
          could buy.
        </p>
        <p>
          <strong>If we ever offer purchases.</strong> The Service is currently
          free and we sell nothing — there is no way to spend real money in Rot
          Royale today. If we later let you buy virtual currency or items, we
          will update these Terms and the "Who you are contracting with" section
          above before doing so (the operating entity may change at that point),
          and the following will apply from the moment purchases go live:
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
            <strong>Payment is handled by the app store</strong> (Apple or
            Google) or another payment processor, under their terms. We never
            receive or store your card details.
          </li>
          <li>
            <strong>Price and contents are shown before you confirm.</strong> A
            purchase gives you virtual items only — never an advantage in ranked
            play, and never a chance at money.
          </li>
          <li>
            <strong>Purchases are final</strong> once the items are delivered to
            your account, except where refunds are required by law or granted by
            the app store. You may always request a refund directly from Apple
            or Google under their policies, and where you have a statutory right
            of withdrawal (for example as a consumer in the UK/EU) that right is
            unaffected.
          </li>
          <li>
            <strong>Unused balances are not refundable in cash</strong> and are
            not redeemable for money. If we discontinue the Service or a
            specific item, we will give reasonable notice and will not sell
            items we know we are about to withdraw.
          </li>
          <li>
            <strong>
              If your account is terminated for breaking these Terms
            </strong>
            , virtual items and balances are forfeited without refund, to the
            extent the law allows.
          </li>
          <li>
            <strong>Minors.</strong> If you are under 18, you may only make a
            purchase with the consent of a parent or guardian who is responsible
            for the account.
          </li>
        </ul>
        <p>
          Nothing in this section limits your rights under mandatory
          consumer-protection law where you live.
        </p>
      </LegalSection>

      <LegalSection heading="Billing problems">
        <p>
          If a purchase does not arrive, is charged twice, or you believe you
          were billed in error, contact us at{" "}
          <a href="mailto:thomas@webhorizondigital.com" style={legalLink}>
            thomas@webhorizondigital.com
          </a>{" "}
          and, where the purchase was made through an app store, that store's
          support. We will investigate and correct genuine errors. Please raise
          billing issues with us before starting a chargeback so we have a
          chance to fix it.
        </p>
      </LegalSection>

      <LegalSection heading="Intellectual property">
        <p>
          The Service, including its name, branding, design, and questions, is
          owned by us or our licensors and protected by law.
        </p>
      </LegalSection>

      <LegalSection heading="Disclaimers">
        <p>
          The Service is provided "as is" and "as available," without
          warranties. We don't guarantee it will be uninterrupted, error-free,
          or that all questions and answers are accurate.
        </p>
      </LegalSection>

      <LegalSection heading="Limitation of liability">
        <p>
          To the fullest extent permitted by law, Thomas Caruso is not liable
          for indirect, incidental, or consequential damages from your use of
          the Service.
        </p>
      </LegalSection>

      <LegalSection heading="Termination">
        <p>
          We may suspend or terminate access if you violate these Terms. You may
          stop using the Service and delete your account at any time.
        </p>
      </LegalSection>

      <LegalSection heading="Governing law">
        <p>
          These Terms are governed by the laws of the State of Wyoming, United
          States, without regard to its conflict-of-laws rules. If you live
          outside the United States, this does not take away the protection of
          any mandatory consumer-protection law of your home country.
        </p>
      </LegalSection>

      <LegalSection heading="Resolving a problem — talk to us first">
        <p>
          Most problems are a misunderstanding or a bug. Before starting a
          formal proceeding, please email{" "}
          <a href="mailto:thomas@webhorizondigital.com" style={legalLink}>
            thomas@webhorizondigital.com
          </a>{" "}
          describing the issue and what you would like done. We will try in good
          faith to resolve it within 60 days. This step is required before
          either of us starts arbitration, and it applies to us as well as to
          you.
        </p>
      </LegalSection>

      <LegalSection heading="Arbitration agreement and class-action waiver">
        <p>
          <strong>
            Please read this section carefully. It affects how disputes between
            you and us are resolved, and it limits the ways you can seek relief.
          </strong>
        </p>
        <p>
          <strong>Agreement to arbitrate.</strong> If we cannot resolve a
          dispute informally, you and Rot Royale agree that any dispute arising
          out of or relating to these Terms or the Service will be resolved by
          binding individual arbitration, administered by the American
          Arbitration Association under its Consumer Arbitration Rules, rather
          than in court. The arbitrator decides the dispute, and judgment on the
          award may be entered in any court with jurisdiction.
        </p>
        <p>
          <strong>Exceptions — what is not arbitrated.</strong> Either of us may
          still (a) bring an individual claim in small-claims court, and (b)
          seek an injunction in court to stop infringement or misuse of
          intellectual property. Nothing here prevents you from reporting a
          concern to a government agency or regulator.
        </p>
        <p>
          <strong>Class-action waiver.</strong> Claims must be brought
          individually. You and we each waive any right to bring or participate
          in a class, collective, consolidated, or representative action. The
          arbitrator may not preside over any form of representative proceeding.
          If this waiver is found unenforceable as to a particular claim, that
          claim (and only that claim) will proceed in court.
        </p>
        <p>
          <strong>Costs.</strong> Where the AAA Consumer Arbitration Rules
          require, we will pay the arbitration filing, administration, and
          arbitrator fees. If you have never paid us anything, we will pay those
          fees regardless of what the rules require — you should not face a
          filing fee larger than any dispute could be worth. You remain
          responsible for your own attorneys' fees unless the arbitrator awards
          otherwise.
        </p>
        <p>
          <strong>Small disputes.</strong> If your claim is for $250 or less,
          you may choose to have it decided entirely on written submissions,
          with no hearing to attend.
        </p>
        <p>
          <strong>Venue.</strong> Arbitration will take place in the county
          where you live, or remotely by phone or video, or by written
          submission — whichever you choose. You will not be required to travel
          to Wyoming.
        </p>
        <p>
          <strong>How to opt out — you have 30 days.</strong> You can reject
          this arbitration agreement and keep your right to go to court. Email{" "}
          <a href="mailto:thomas@webhorizondigital.com" style={legalLink}>
            thomas@webhorizondigital.com
          </a>{" "}
          with the subject line <strong>"Arbitration Opt-Out"</strong> and your
          username, within 30 days of first accepting these Terms. You may also
          post the same notice to the address in "Who you are contracting with"
          above. Opting out costs you nothing, changes nothing else about your
          account, and we will not treat you differently for it.
        </p>
        <p>
          <strong>If you are outside the United States.</strong> This section
          applies only to the extent your local law permits. If you are a
          consumer in the UK, EU, or EEA, nothing here removes your right to
          bring proceedings in the courts of your country of residence, or to
          use an alternative dispute-resolution scheme available to you.
        </p>
        <p>
          <strong>Survival.</strong> This section survives termination of your
          account and these Terms.
        </p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          We may update these Terms and will revise the "Last updated" date.
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
