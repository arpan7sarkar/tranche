"use client";

import { ArrowUpRight, Check, ChevronRight } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";

const views = [
  {
    id: "schedule",
    label: "Plan the work",
    title: "A plan you can actually work from.",
    description:
      "Review milestones, prices, and acceptance criteria. Then see how the tasks depend on each other in a schedule you can adjust.",
    points: [
      "AI-generated milestone structure",
      "Interactive Gantt scheduling",
      "Visible dates and dependencies",
    ],
    image: "/product/schedule.png",
    alt: "Actual Tranche workspace with a Bryntum Gantt schedule and milestone details",
    tool: "Scheduling with Bryntum Gantt",
  },
  {
    id: "verification",
    label: "Verify the delivery",
    title: "See the evidence behind the decision.",
    description:
      "Inspect delivery checks, reviewer notes, and milestone activity in one place. Failed checks send the work back for correction.",
    points: [
      "Machine checks before release",
      "Structured AI assessment",
      "A traceable record of decisions",
    ],
    image: "/product/verification.png",
    alt: "Actual Tranche milestone with passed delivery checks, paid-out status, and project activity",
    tool: "Delivery evidence and milestone activity",
  },
  {
    id: "cash-flow",
    label: "Know where you stand",
    title: "Your projects, in financial focus.",
    description:
      "See held funds, released payments, and forecasts across your deals. Ask the assistant about the data while keeping payment approvals in your hands.",
    points: [
      "Held, released, and forecast amounts",
      "Deal tables and payment charts",
      "Agent activity and dashboard assistant",
    ],
    image: "/product/cash-flow.png",
    alt: "Actual Tranche cash-flow dashboard showing one dollar released and forecast payments across demo deals",
    tool: "Cash flow with AG Studio",
  },
] as const;

export function LandingProduct() {
  const [selected, setSelected] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const view = views[selected] ?? views[0];

  return (
    <div className="product-explorer">
      <div role="tablist" aria-label="Explore Tranche" className="product-tabs">
        {views.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={selected === index}
            aria-controls={`panel-${item.id}`}
            tabIndex={selected === index ? 0 : -1}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % views.length;
              else if (event.key === "ArrowLeft") next = (index + views.length - 1) % views.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = views.length - 1;
              else return;
              event.preventDefault();
              setSelected(next);
              tabs.current[next]?.focus();
            }}
          >
            <span className="tab-number">0{index + 1}</span>
            {item.label}
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
      {views.map((item, index) => (
        <div
          key={item.id}
          role="tabpanel"
          id={`panel-${item.id}`}
          aria-labelledby={`tab-${item.id}`}
          hidden={selected !== index}
        >
          {selected === index ? (
            <div className="product-panel">
              <figure className="product-capture">
                <div className="capture-heading">
                  <span>{view.tool}</span>
                  <span>Actual product view</span>
                </div>
                <Image
                  src={view.image}
                  width={1500}
                  height={1000}
                  alt={view.alt}
                  sizes="(max-width: 900px) 100vw, 65vw"
                />
                <figcaption>
                  <span>Demo project data</span>
                  <a href={view.image} target="_blank" rel="noreferrer">
                    Open full size <ArrowUpRight size={14} aria-hidden="true" />
                  </a>
                </figcaption>
              </figure>
              <div className="product-copy">
                <h3>{view.title}</h3>
                <p>{view.description}</p>
                <ul>
                  {view.points.map((point) => (
                    <li key={point}>
                      <Check size={17} aria-hidden="true" />
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
