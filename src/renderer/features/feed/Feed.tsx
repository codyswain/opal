import { Card } from "@/renderer/shared/components/Card";

const Feed = () => (
  <div className="container mx-auto p-4 mt-2">
    <h2 className="text-2xl font-bold mb-4">Welcome</h2>
    <Card className="p-6 mb-6">
      <h3 className="text-xl font-semibold mb-3">About</h3>
      <p className="mb-4">
        This tool is focused on providing great UX for information management.
      </p>
    </Card>

    <Card className="p-6 mb-6">
      <h3 className="text-xl font-semibold mb-3">
        Getting Started
      </h3>
      <p className="mb-4">
        To get started, please follow these steps:
      </p>
      <ol className="list-decimal list-inside">
        <li>Go to the Settings page (in the top right)</li>
        <li>Enter your OpenAI API key in the designated field</li>
      </ol>
      <p className="mt-4">
        Currently, the OpenAI API key is only used to calculate vector
        embeddings of content, which are then ONLY stored on your local file
        system and possible by OpenAI. No guarantees may be made about how
        OpenAI handles the data on their end.
      </p>
    </Card>

    <Card className="p-6">
      <h3 className="text-xl font-semibold mb-3">
        Feature Status
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h4 className="font-bold mb-2">
            Functional Features:
          </h4>
          <ul className="list-disc list-inside">
            <li>Create, edit, and delete notes</li>
            <li>Light and dark theme</li>
            <li>Auto-save functionality</li>
            <li>Sidebar for quick note navigation</li>
          </ul>
        </div>
        <div>
          <h4 className="font-bold mb-2">In Progress:</h4>
          <ul className="list-disc list-inside">
            <li>Markdown editing (partially implemented)</li>
            <li>Automatic embedding process</li>
            <li>Feed implementation</li>
            <li>File tab implementation</li>
            <li>Infinitely nestable data structures</li>
            <li>AI-first search and chat functionality</li>
            <li>Customizable background agents</li>
          </ul>
        </div>
      </div>
    </Card>
  </div>
);

export default Feed;