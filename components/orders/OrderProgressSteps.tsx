"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { feedbackStyles } from "@/lib/ui/feedback";

type Stage = "Picking List" | "Packing List" | "Label" | "Invoice";

const STAGES: Stage[] = ["Picking List", "Packing List", "Label", "Invoice"];
const stageLabels: Record<Stage, string> = { "Picking List": "Daftar ambil", "Packing List": "Daftar kemas", Label: "Label", Invoice: "Faktur" };

interface Props {
  currentStage: Stage | null;
}

export default function OrderProgressSteps({ currentStage }: Props) {
  const currentIndex = currentStage ? STAGES.indexOf(currentStage) : -1;

  return (
    <div className="flex flex-wrap items-center gap-1" aria-label="Tahap pemrosesan pesanan">
      {STAGES.map((stage, idx) => {
        const isCompleted = idx <= currentIndex;
        const Icon = isCompleted ? CheckCircle2 : Circle;

        return (
          <div key={stage} className="flex items-center gap-1">
            <div
              className={`px-3 py-1 border rounded-full text-xs font-semibold flex items-center gap-1
                ${feedbackStyles[isCompleted ? "success" : "neutral"]}`}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {stageLabels[stage]}
              <span className="sr-only">: {isCompleted ? "Selesai" : "Belum selesai"}</span>
            </div>
            {idx < STAGES.length - 1 && (
              <span className="text-muted-foreground text-xs" aria-hidden="true">&gt;</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
