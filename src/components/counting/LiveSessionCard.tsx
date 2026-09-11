import { Card, CardContent } from '../ui/card';
import { formatDistanceToNow } from 'date-fns';
import React from 'react';

export interface CountingSessionData {
  id: string;
  userName: string;
  status: string;
  progress?: {
    basketsCounted?: number;
    totalVials?: number;
    vialsCounted?: number;
    traysCounted?: number;
  };
  countedBaskets?: string[];
  startedAt: string;
  locationId?: string;
}

export interface LiveSessionCardProps {
  session: CountingSessionData;
}

export const LiveSessionCard: React.FC<LiveSessionCardProps> = ({ session }) => {
  const bins = session.countedBaskets?.length ?? session.progress?.basketsCounted ?? 0;
  const trays = session.progress?.traysCounted ?? 0;
  const vials = session.progress?.vialsCounted ?? session.progress?.totalVials ?? 0;
  const startedAt = new Date(session.startedAt);
  const startedText = Number.isNaN(startedAt.getTime()) ? 'just now' : `${formatDistanceToNow(startedAt)} ago`;

  return (
    <Card className={`border-l-4 ${session.status === 'active' ? 'border-l-teal-500' : 'border-l-amber-500'}`}>
      <CardContent className="p-4 flex flex-col gap-2">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-gray-900">{session.userName}</h3>
            <p className="text-xs text-gray-500">
              {session.status === 'active' ? 'Counting actively' : 'Paused session'} • Started {startedText}
            </p>
          </div>
          <span
            className={`px-2 py-1 text-xs font-medium rounded-full ${
              session.status === 'active' ? 'bg-teal-100 text-teal-800' : 'bg-amber-100 text-amber-800'
            }`}
          >
            {session.status.toUpperCase()}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-2 pt-2 border-t border-gray-100">
          <div>
            <p className="text-xs font-medium text-gray-500">Bins</p>
            <p className="text-lg font-bold text-gray-900 tabular-nums">{bins}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500">Trays</p>
            <p className="text-lg font-bold text-gray-900 tabular-nums">{trays}</p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium text-gray-500">Vials</p>
            <p className="text-lg font-bold text-teal-600 tabular-nums">{vials}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
