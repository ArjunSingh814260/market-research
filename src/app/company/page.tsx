import { Suspense } from "react";

import { CompanyView } from "./CompanyView";

export default function CompanyPage() {
  // CompanyView reads ?fincode= / ?date= with useSearchParams, which needs a Suspense boundary.
  return (
    <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
      <CompanyView />
    </Suspense>
  );
}
