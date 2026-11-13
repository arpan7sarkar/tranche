import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronRight,
  CircleCheck,
  FileText,
  LockKeyhole,
  MessageSquareText,
  Play,
  ShieldCheck,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { LandingProduct } from "@/components/landing-product";
import { TrancheMark } from "@/components/tranche-mark";
import "./landing.css";

const workflow = [
  {
    title: "Make the brief a plan.",
    label: "Brief & agree",
    description:
      "Describe the outcome. Review the AI-generated milestones, prices, and criteria with your client.",
    icon: FileText,
  },
  {
    title: "Give the work a timeline.",
    label: "Schedule & fund",
    description:
      "Connect tasks and dependencies. Your client approves eligible milestone funding through PayPal.",
    icon: LockKeyhole,
  },
  {
    title: "Put the delivery to the test.",
    label: "Deliver & verify",
    description:
      "Submit the work. Machine checks and AI assessment help establish whether it meets the agreed criteria.",
    icon: ShieldCheck,
  },
  {
    title: "Close the loop on payment.",
    label: "Approve & capture",
    description:
      "Required approval gates and client release come before the policy-controlled payment capture.",
    icon: CircleCheck,
  },
];

const technologies = [
  { name: "PayPal", image: "paypal", role: "Milestone payments" },
  { name: "Gemini", image: "gemini", role: "AI planning & assessment" },
  { name: "Bryntum", image: "bryntum", role: "Project scheduling" },
  { name: "AG Grid", image: "aggrid", role: "Cash flow with AG Studio" },
  { name: "Render", image: "render", role: "Background workflows" },
];

const questions = [
  {
    question: "Who is Tranche for?",
    answer:
      "Tranche is built for freelancers and small agencies managing client work in milestones. It brings scope, task scheduling, delivery evidence, client decisions, and payment status into one workspace.",
  },
  {
    question: "Can the AI move money on its own?",
    answer:
      "Agents propose actions; they do not directly execute payments. Deterministic policies, payment eligibility rules, and the required approval gates control execution. The dashboard assistant cannot approve actions or move money.",
  },
  {
    question: "What happens when a delivery fails verification?",
    answer:
      "A failed required machine check blocks verification. You can inspect the evidence, correct the delivery, and resubmit it. An AI assessment cannot override a failed machine check.",
  },
  {
    question: "Is the project using real payments?",
    answer:
      "Tranche currently uses PayPal Sandbox, not live payments. The walkthrough includes a completed USD 1.00 sandbox authorization and capture for an endpoint readiness milestone. That check proves endpoint availability, not a completed website.",
  },
  {
    question: "How does the client stay involved?",
    answer:
      "A private client portal lets your client review the plan, inspect milestone evidence, and approve eligible payment releases. The negotiation room and approval queue make decisions needing human attention visible.",
  },
];

function ProjectPreview() {
  return (
    <figure className="hero-preview" aria-label="Northstar demo project preview">
      <figcaption className="preview-heading">
        <span className="eyebrow">Project workspace</span>
        <h2>Northstar launch readiness</h2>
        <span className="preview-note">Demo project</span>
      </figcaption>
      <section
        className="preview-schedule"
        aria-label="Demo schedule: endpoint readiness November 13 to 16, website implementation November 16 to 21"
      >
        <div className="schedule-dates" aria-hidden="true">
          <span>Nov 13</span>
          <span>Nov 16</span>
          <span>Nov 19</span>
          <span>Nov 21</span>
        </div>
        <div className="schedule-task">
          <span>
            Endpoint
            <br />
            readiness
          </span>
          <div className="schedule-track">
            <span className="schedule-bar endpoint-bar" />
          </div>
        </div>
        <div className="schedule-task">
          <span>
            Website
            <br />
            implementation
          </span>
          <div className="schedule-track">
            <span className="schedule-bar website-bar" />
          </div>
        </div>
      </section>
      <dl className="preview-milestones">
        <div>
          <dt>Live URL readiness check</dt>
          <dd className="preview-price">$1.00</dd>
          <dd className="preview-status paid">
            <Check size={14} aria-hidden="true" /> Paid out
          </dd>
        </div>
        <div>
          <dt>Studio website implementation</dt>
          <dd className="preview-price">$4,799.00</dd>
          <dd className="preview-status">Agreed</dd>
        </div>
      </dl>
      <ol className="preview-gates" aria-label="Paid milestone approval steps">
        {["Plan reviewed", "Delivery verified", "Client approved"].map((label, index) => (
          <li key={label}>
            <CircleCheck size={22} aria-hidden="true" />
            <span>{label}</span>
            {index < 2 ? (
              <ChevronRight className="gate-arrow" size={17} aria-hidden="true" />
            ) : null}
          </li>
        ))}
      </ol>
      <p className="preview-disclaimer">
        PayPal Sandbox demo <span>Implementation milestone unfunded</span>
      </p>
    </figure>
  );
}

export default function Home() {
  return (
    <div className="landing">
      <a href="#main-content" className="landing-skip">
        Skip to content
      </a>
      <header className="landing-header landing-container">
        <Link href="/" className="landing-brand" aria-label="Tranche home">
          <TrancheMark />
          <span>Tranche</span>
        </Link>
        <nav aria-label="Main navigation" className="landing-nav">
          <a href="#how-it-works">How it works</a>
          <a href="#workspace">The workspace</a>
          <a href="#questions">Questions</a>
        </nav>
        <div className="header-actions">
          <Link href="/sign-in" className="sign-in-link">
            Sign in
          </Link>
          <Link href="/sign-up" className="landing-button primary compact">
            Get started <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </div>
      </header>
      <main id="main-content">
        <section className="hero landing-container" aria-labelledby="hero-heading">
          <div className="hero-copy">
            <p className="eyebrow">Built for independent work</p>
            <h1 id="hero-heading">
              Good work deserves
              <br className="hero-break" /> a clear path
              <br className="hero-break" /> to paid.
            </h1>
            <p className="hero-description">
              Turn client briefs into AI plans, verify each milestone, and manage payments through
              PayPal. You stay in control.
            </p>
            <div className="hero-actions">
              <Link href="/sign-up" className="landing-button primary">
                Start a project <ArrowRight size={21} aria-hidden="true" />
              </Link>
              <a href="#demo" className="landing-button demo-link">
                <span className="play-circle">
                  <Play size={14} aria-hidden="true" />
                </span>{" "}
                Watch the demo
              </a>
            </div>
            <p className="hero-reassurance">AI-assisted planning. Human-approved payments.</p>
          </div>
          <ProjectPreview />
        </section>
        <div className="hero-baseline landing-container">
          <span>From the first brief to the final milestone.</span>
          <a href="#how-it-works">
            Follow the workflow <ArrowDown size={16} aria-hidden="true" />
          </a>
        </div>

        <section
          id="how-it-works"
          className="landing-section landing-container"
          aria-labelledby="workflow-heading"
        >
          <div className="section-heading">
            <div>
              <p className="eyebrow">A connected workflow</p>
              <h2 id="workflow-heading">
                Less chasing.
                <br />
                More moving forward.
              </h2>
            </div>
            <p>
              Scope, schedules, evidence, approvals, and payments. Every step belongs to the same
              project.
            </p>
          </div>
          <ol className="workflow-grid">
            {workflow.map((step, index) => (
              <li key={step.label}>
                <div className="workflow-step-label">
                  <span className="step-number">0{index + 1}</span>
                  <step.icon size={22} strokeWidth={1.5} aria-hidden="true" />
                </div>
                <span className="eyebrow workflow-label">{step.label}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
                {index < 3 ? (
                  <ChevronRight className="workflow-arrow" size={18} aria-hidden="true" />
                ) : null}
              </li>
            ))}
          </ol>
          <p className="workflow-footnote">
            <MessageSquareText size={17} aria-hidden="true" /> A question about scope? The
            negotiation room keeps the conversation and human review visible.
          </p>
        </section>

        <section id="workspace" className="workspace-section" aria-labelledby="workspace-heading">
          <div className="landing-container">
            <div className="section-heading">
              <div>
                <p className="eyebrow">The actual workspace</p>
                <h2 id="workspace-heading">
                  The details matter.
                  <br />
                  Keep them together.
                </h2>
              </div>
              <p>
                A clear view of what you promised, what you delivered, and where your projects
                stand.
              </p>
            </div>
            <LandingProduct />
          </div>
        </section>

        <section
          id="approvals"
          className="landing-section landing-container protection-section"
          aria-labelledby="protection-heading"
        >
          <div className="protection-copy">
            <span className="section-icon">
              <ShieldCheck size={27} strokeWidth={1.4} aria-hidden="true" />
            </span>
            <p className="eyebrow">Assistance with boundaries</p>
            <h2 id="protection-heading">
              A checkpoint before
              <br />
              every payment.
            </h2>
            <p>
              Useful automation comes with evidence you can inspect and decisions you can review.
            </p>
            <p className="protection-promise">AI recommends. Your approvals set the boundaries.</p>
          </div>
          <div className="protection-flow">
            <ol>
              <li>
                <span className="check-point">01</span>
                <div>
                  <h3>The work is checked.</h3>
                  <p>
                    Required machine checks gate verification. An AI assessment cannot override a
                    failed check.
                  </p>
                  <span className="failure-note">
                    Failed check? Correct the delivery and resubmit.
                  </span>
                </div>
              </li>
              <li>
                <span className="check-point">02</span>
                <div>
                  <h3>People make the important calls.</h3>
                  <p>
                    Review requests are surfaced, and client release is explicit. The agent never
                    directly moves money.
                  </p>
                </div>
              </li>
              <li>
                <span className="check-point">03</span>
                <div>
                  <h3>The payment follows the rules.</h3>
                  <p>
                    Eligible PayPal writes follow deterministic policies. Payment status and
                    decisions stay traceable.
                  </p>
                </div>
              </li>
            </ol>
            <p className="protection-footer">
              <LockKeyhole size={16} aria-hidden="true" /> Scope. Evidence. Approval. Payment.
            </p>
          </div>
        </section>

        <section id="demo" className="demo-section" aria-labelledby="demo-heading">
          <div className="landing-container">
            <div className="section-heading">
              <div>
                <p className="eyebrow">See it in practice</p>
                <h2 id="demo-heading">
                  Small payment.
                  <br />
                  Complete path.
                </h2>
              </div>
              <p>
                The walkthrough follows a real demo project through planning, verification, client
                release, and a completed $1.00 PayPal Sandbox capture.
              </p>
            </div>
            <div className="walkthrough-frame">
              <div className="walkthrough-heading">
                <span>Tranche, from brief to milestone</span>
                <span>02:56 · Product walkthrough</span>
              </div>
              <video
                controls
                preload="none"
                poster="/product/cash-flow.png"
                aria-label="Tranche product walkthrough with narration"
              >
                <source src="/demo/tranche-walkthrough.mp4" type="video/mp4" />
                <track
                  kind="captions"
                  src="/demo/walkthrough.vtt"
                  srcLang="en"
                  label="English"
                  default
                />
                Your browser does not support this video.{" "}
                <a href="/demo/tranche-walkthrough.mp4">Download the walkthrough.</a>
              </video>
            </div>
            <p className="demo-context">
              The $1.00 milestone proves endpoint availability. The separate website implementation
              remains agreed and unfunded. All payments shown use PayPal Sandbox.
            </p>
          </div>
        </section>

        <section
          className="landing-section landing-container technology-section"
          aria-labelledby="technology-heading"
        >
          <p id="technology-heading" className="eyebrow">
            Built with tools that do their part
          </p>
          <div className="technology-grid">
            {technologies.map((tool) => (
              <div key={tool.name}>
                <div className="technology-name">
                  <Image
                    src={`/brand/${tool.image}.png`}
                    alt=""
                    width={110}
                    height={36}
                    className={`technology-logo logo-${tool.image}`}
                  />
                  <span>{tool.name}</span>
                </div>
                <p>{tool.role}</p>
              </div>
            ))}
          </div>
        </section>

        <section
          id="questions"
          className="questions-section landing-container"
          aria-labelledby="questions-heading"
        >
          <div>
            <p className="eyebrow">A few things to know</p>
            <h2 id="questions-heading">
              Good questions.
              <br />
              Clear answers.
            </h2>
          </div>
          <div className="questions-list">
            {questions.map((item) => (
              <details key={item.question}>
                <summary>
                  {item.question}
                  <ChevronRight size={18} aria-hidden="true" />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="closing-section landing-container" aria-labelledby="closing-heading">
          <p className="eyebrow">Your next project, with a little more clarity</p>
          <h2 id="closing-heading">
            Do the work you love.
            <br />
            <span>Keep the rest in view.</span>
          </h2>
          <Link href="/sign-up" className="landing-button primary">
            Create your workspace <ArrowRight size={20} aria-hidden="true" />
          </Link>
          <p>
            Already have a workspace? <Link href="/sign-in">Sign in</Link>
          </p>
        </section>
      </main>
      <footer className="landing-footer landing-container">
        <Link href="/" className="landing-brand">
          <TrancheMark />
          <span>Tranche</span>
        </Link>
        <p>Clear milestones. Confident payments.</p>
        <div>
          <a href="#how-it-works">How it works</a>
          <a href="#demo">Watch demo</a>
          <Link href="/sign-in">Sign in</Link>
        </div>
        <p className="footer-note">PayPal AI Hackathon project. PayPal Sandbox only.</p>
      </footer>
    </div>
  );
}
