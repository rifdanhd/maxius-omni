export default function PlaceholderPage() {
  return (
    <div className="flex h-full min-h-[80vh] flex-col items-center justify-center p-8 text-center">
      <div className="mb-6 rounded-2xl bg-gray-100 p-6">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400">
          <path d="M12 2v20"></path>
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
        </svg>
      </div>
      <h1 className="mb-2 text-2xl font-bold text-gray-900">Halaman Reports / Sales</h1>
      <p className="max-w-md text-gray-500">
        Halaman ini masih dalam tahap pengembangan dan akan segera hadir pada update berikutnya.
      </p>
    </div>
  );
}
