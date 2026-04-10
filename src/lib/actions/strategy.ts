"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createStrategicGoal, updateStrategicGoal } from "@/lib/db/queries/workspaces";
import { revalidatePath } from "next/cache";

export async function createGoalAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspaceId = formData.get("workspaceId") as string;
  const type = formData.get("type") as "goal" | "objective" | "key_result";
  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const parentId = formData.get("parentId") as string | null;
  const direction = formData.get("direction") as
    | "increase"
    | "decrease"
    | "maintain"
    | null;
  const targetValue = formData.get("targetValue")
    ? Number(formData.get("targetValue"))
    : null;
  const currentValue = formData.get("currentValue")
    ? Number(formData.get("currentValue"))
    : null;
  const owner = formData.get("owner") as string;
  const timeframe = formData.get("timeframe") as string;
  const kpiName = formData.get("kpiName") as string;
  const kpiUnit = formData.get("kpiUnit") as string;

  if (!title?.trim()) throw new Error("Il titolo è obbligatorio");

  await createStrategicGoal({
    workspaceId,
    parentId: parentId || null,
    type,
    title: title.trim(),
    description: description?.trim() || null,
    direction,
    targetValue,
    currentValue,
    owner: owner?.trim() || null,
    timeframe: timeframe?.trim() || null,
    kpiName: kpiName?.trim() || null,
    kpiUnit: kpiUnit?.trim() || null,
  });

  revalidatePath(`/dashboard/${workspaceId}/strategy`);
}

export async function updateGoalAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const id = formData.get("id") as string;
  const workspaceId = formData.get("workspaceId") as string;
  const title = formData.get("title") as string;
  const description = formData.get("description") as string;
  const direction = formData.get("direction") as
    | "increase"
    | "decrease"
    | "maintain"
    | null;
  const targetValue = formData.get("targetValue")
    ? Number(formData.get("targetValue"))
    : undefined;
  const currentValue = formData.get("currentValue")
    ? Number(formData.get("currentValue"))
    : undefined;
  const owner = formData.get("owner") as string;

  await updateStrategicGoal(id, {
    title: title?.trim(),
    description: description?.trim() || null,
    direction: direction || undefined,
    targetValue,
    currentValue,
    owner: owner?.trim() || null,
  });

  revalidatePath(`/dashboard/${workspaceId}/strategy`);
}
