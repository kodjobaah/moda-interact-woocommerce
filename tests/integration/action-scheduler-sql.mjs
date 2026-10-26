import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const actionQuery = `SELECT a.action_id, a.extended_args
FROM wp_actionscheduler_actions AS a
JOIN wp_actionscheduler_groups AS g ON g.group_id = a.group_id
WHERE a.hook = 'moda_interact_dispatch_checkout_activity'
	AND a.status = 'pending'
	AND g.slug = 'moda-interact-activity'
ORDER BY a.action_id DESC
LIMIT 100`;

export function parsePendingCheckoutActions(output) {
	if (output.trim() === '') {
		return [];
	}

	return output
		.trimEnd()
		.split('\n')
		.map((line) => {
			const separator = line.indexOf('\t');
			assert.ok(separator > 0, 'Action Scheduler SQL row is malformed');
			const id = line.slice(0, separator);
			assert.match(id, /^\d+$/, 'Action Scheduler action ID is invalid');
			let args;
			try {
				args = JSON.parse(line.slice(separator + 1));
			} catch {
				throw new Error(
					`Action Scheduler action ${id} does not have JSON extended_args`
				);
			}
			assert.ok(
				args && typeof args === 'object' && !Array.isArray(args),
				`Action Scheduler action ${id} args must be an object`
			);
			return { id, args };
		});
}

export function readPendingCheckoutActions(composeFile) {
	const shellCommand =
		'mariadb -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE" -N -e "$1"';
	const output = execFileSync(
		'docker',
		[
			'compose',
			'-f',
			composeFile,
			'exec',
			'-T',
			'mysql',
			'sh',
			'-c',
			shellCommand,
			'sh',
			actionQuery,
		],
		{ encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
	);
	return parsePendingCheckoutActions(output);
}
