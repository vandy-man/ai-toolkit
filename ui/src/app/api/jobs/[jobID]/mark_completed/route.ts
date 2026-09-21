import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/server/prisma';

// 强制标记任务为 completed (用于孤儿 running 状态, 不影响进程)
export async function GET(request: NextRequest, { params }: { params: { jobID: string } }) {
  const { jobID } = await params;

  const job = await prisma.job.findUnique({
    where: { id: jobID },
  });
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  await prisma.job.update({
    where: { id: jobID },
    data: {
      status: 'completed',
      info: 'Job completed (forced)',
      pid: null,
    },
  });

  console.log(`Job ${jobID} marked as completed`);

  return NextResponse.json(job);
}
