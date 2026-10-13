"use client";

import dynamic from "next/dynamic";
import { LoadingState } from "@/components/states";

export const GanttLoader = dynamic(() => import("./deal-gantt"), {
  ssr: false,
  loading: () => <LoadingState rows={8} />,
});
