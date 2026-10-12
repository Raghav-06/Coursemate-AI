import { Segmented } from "../ui";
import ExamPlanPanel from "./ExamPlanPanel";
import ExamInsightsPanel from "../insights/ExamInsightsPanel";

/** A course's "Exams" area: the revision plan and past-paper insights. */
export default function ExamsPanel({ tab, onTabChange, notebook, units, sources, onStartTask, insightsProps }) {
  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 flex justify-center px-4 pt-4">
        <Segmented
          label="Exams view"
          value={tab}
          onChange={onTabChange}
          options={[
            ["plan", "Revision plan"],
            ["papers", "Past papers"],
          ]}
        />
      </div>
      <div className="flex-1 min-h-0">
        {tab === "papers" ? (
          <ExamInsightsPanel key={insightsProps.initialTopicId} notebook={notebook} units={units} {...insightsProps} />
        ) : (
          <ExamPlanPanel notebook={notebook} units={units} sources={sources} onStartTask={onStartTask} />
        )}
      </div>
    </div>
  );
}
