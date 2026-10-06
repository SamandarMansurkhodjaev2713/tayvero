"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";
import {
	FOLLOW_UP_LIMIT,
	followUpLoadState,
	removeConfirmedFollowUp,
} from "./follow-up-model.mjs";
import { FollowUpQueueView } from "./personal-follow-ups-view";

export function PersonalFollowUps() {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const queryClient = useQueryClient();
	const workspaceUrl = useWorkspaceUrl();
	const [now, setNow] = useState<Date | null>(null);
	const [feedback, setFeedback] = useState("");
	const options = trpc.activities.myTasks.queryOptions({
		window: "all",
		limit: FOLLOW_UP_LIMIT,
	});
	const query = useQuery(options);
	useEffect(() => {
		const updateClock = () => setNow(new Date());
		updateClock();
		const interval = window.setInterval(updateClock, 60_000);
		window.addEventListener("focus", updateClock);
		document.addEventListener("visibilitychange", updateClock);
		return () => {
			window.clearInterval(interval);
			window.removeEventListener("focus", updateClock);
			document.removeEventListener("visibilitychange", updateClock);
		};
	}, []);
	const complete = useMutation(
		trpc.activities.complete.mutationOptions({
			onMutate: () => setFeedback(""),
			onSuccess: async (result) => {
				queryClient.setQueryData<RouterOutputs["activities"]["myTasks"]>(
					options.queryKey,
					(tasks) => removeConfirmedFollowUp(tasks, result),
				);
				setFeedback(
					result.completedAt
						? "Task marked as done."
						: "Completion was not confirmed. Refresh before trying again.",
				);
				await cache.activity();
			},
		}),
	);
	return (
		<FollowUpQueueView
			tasks={query.data ?? []}
			now={now}
			state={followUpLoadState(query.data, query.isError, now !== null)}
			isFetching={query.isFetching}
			pendingId={complete.isPending ? complete.variables?.id : undefined}
			error={complete.error?.message}
			feedback={feedback}
			workspaceUrl={workspaceUrl}
			onRefresh={() => void query.refetch()}
			onComplete={(id) => complete.mutate({ id, completed: true })}
		/>
	);
}
