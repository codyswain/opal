import {
  KBarAnimator,
  KBarPortal,
  KBarPositioner,
  KBarSearch,
  KBarResults,
  useMatches,
  ActionImpl,
} from "kbar";

const KBar = () => {
  return (
    <KBarPortal>
      <KBarPositioner className="fixed inset-0 z-50 flex items-start justify-center bg-black bg-opacity-50">
        <KBarAnimator className="max-w-xl w-full bg-white dark:bg-gray-800 shadow-lg rounded-lg overflow-hidden">
          <KBarSearch className="px-4 py-3 text-base w-full box-border outline-none border-none text-black dark:text-white bg-white dark:bg-gray-800" />
          <RenderResults />
        </KBarAnimator>
      </KBarPositioner>
    </KBarPortal>
  );
};

function RenderResults() {
  const { results } = useMatches();

  return (
    <KBarResults
      items={results}
      onRender={({ item, active }: { item: ActionImpl; active: boolean }) => (
        <div
          className={`px-4 py-2 cursor-pointer ${
            active
              ? "bg-blue-500 text-white"
              : "bg-white dark:bg-gray-800 text-black dark:text-white"
          }`}
        >
          {item.name}
        </div>
      )}
    />
  );
}

export { KBar };
