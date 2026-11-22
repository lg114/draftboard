export function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
