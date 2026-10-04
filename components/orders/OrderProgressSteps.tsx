"use client";

type Stage = "Picking List" | "Packing List" | "Label" | "Invoice";

const STAGES: Stage[] = ["Picking List", "Packing List", "Label", "Invoice"];

interface Props {
  currentStage: Stage | null;
}

export default function OrderProgressSteps({ currentStage }: Props) {
  // Find index of current stage. If null, it means no stage is completed yet (-1).
  const currentIndex = currentStage ? STAGES.indexOf(currentStage) : -1;

  return (
    <div className="flex items-center gap-1">
      {STAGES.map((stage, idx) => {
        const isCompleted = idx <= currentIndex;
        
        return (
          <div key={stage} className="flex items-center gap-1">
            <div 
              className={`px-3 py-1 rounded-full text-xs font-semibold flex items-center gap-1
                ${isCompleted ? 'bg-muted-foreground text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            >
              {stage}
            </div>
            {idx < STAGES.length - 1 && (
              <span className="text-muted-foreground text-xs">&gt;</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
