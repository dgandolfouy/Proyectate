export enum TaskStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
}

export interface User {
  id: string;
  name: string;
  avatarColor: string;
  avatarUrl?: string; // New: Profile picture
}

export const USERS: User[] = [
  { 
    id: 'u-leticia', 
    name: 'Leticia', 
    avatarColor: 'bg-rose-500',
    avatarUrl: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?q=80&w=150&auto=format&fit=crop' 
  },
  { 
    id: 'u-daniel', 
    name: 'Daniel', 
    avatarColor: 'bg-blue-500',
    avatarUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?q=80&w=150&auto=format&fit=crop'
  },
];

export interface Attachment {
  id: string;
  name: string;
  type: 'image' | 'document' | 'audio' | 'video' | 'link';
  url: string;
  createdAt: number;
  createdBy: string; // User ID
}

export interface ActivityLog {
  id: string;
  content: string;
  type: 'comment' | 'status_change' | 'creation' | 'attachment' | 'ai_suggestion';
  timestamp: number;
  createdBy: string; // User ID
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  subtasks: Task[]; // Recursive
  attachments: Attachment[];
  activity: ActivityLog[];
  tags: string[]; 
  expanded?: boolean;
  createdBy: string; // User ID
  
  // AI Integration
  aiContext?: string; // Hidden context for the AI
  suggestedSteps?: string; // AI generated suggestions
}

export interface Project {
  id: string;
  title: string;
  subtitle: string; 
  createdAt: number;
  createdBy: string; // User ID
  tasks: Task[];
  imageUrl?: string; // New: Project cover/logo
}

export interface AppState {
  projects: Project[];
}

export const INITIAL_APP_STATE: AppState = {
  projects: [
    {
      id: 'p-1',
      title: "Taoasis",
      subtitle: "Proyecto de Inversión",
      createdAt: Date.now(),
      createdBy: 'u-leticia',
      imageUrl: 'https://images.unsplash.com/photo-1602143407151-011141950039?q=80&w=600&auto=format&fit=crop', // Essential Oils aesthetic
      tasks: [] 
    }
  ]
};