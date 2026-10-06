import { EvaluationDetail } from '@/components/evaluation-detail';
export default async function EvaluationPage({ params }: { params: Promise<{ id: string }> }) {
  return <EvaluationDetail id={(await params).id} />;
}
