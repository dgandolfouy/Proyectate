import React, { useState, useEffect, createContext, useContext, useCallback, useMemo, useRef } from 'react';
import { Task, TaskStatus, AppState, INITIAL_APP_STATE, Attachment, ActivityLog, Project, User, USERS } from './types';
import { Icons } from './components/Icons';
import { getStrategicAdvice } from './services/geminiService';

// --- HELPERS ---
const generateId = () => Math.random().toString(36).substring(2, 10);

const getTaskProgress = (task: Task): number => {
  if (task.subtasks.length === 0) {
    return task.status === TaskStatus.COMPLETED ? 100 : 0;
  }
  const totalProgress = task.subtasks.reduce((acc, sub) => acc + getTaskProgress(sub), 0);
  return Math.round(totalProgress / task.subtasks.length);
};

const getProjectProgress = (project: Project): number => {
    if (project.tasks.length === 0) return 0;
    const total = project.tasks.reduce((acc, t) => acc + getTaskProgress(t), 0);
    return Math.round(total / project.tasks.length);
};

// Recursive search
const searchTasks = (tasks: Task[], query: string): Task[] => {
  return tasks.reduce((acc: Task[], task) => {
    const match = task.title.toLowerCase().includes(query.toLowerCase()) || 
                  task.description?.toLowerCase().includes(query.toLowerCase());
    const childMatches = searchTasks(task.subtasks, query);
    if (match || childMatches.length > 0) {
      acc.push({ ...task, subtasks: childMatches, expanded: true });
    }
    return acc;
  }, []);
};

// State Updates
const findTaskAndUpdate = (tasks: Task[], targetId: string, updater: (t: Task) => Task): Task[] => {
  return tasks.map(task => {
    if (task.id === targetId) return updater(task);
    if (task.subtasks.length > 0) return { ...task, subtasks: findTaskAndUpdate(task.subtasks, targetId, updater) };
    return task;
  });
};

const findTaskAndAddSubtask = (tasks: Task[], parentId: string, newTask: Task): Task[] => {
  return tasks.map(task => {
    if (task.id === parentId) return { ...task, subtasks: [...task.subtasks, newTask], expanded: true };
    if (task.subtasks.length > 0) return { ...task, subtasks: findTaskAndAddSubtask(task.subtasks, parentId, newTask) };
    return task;
  });
};

const findTaskAndDelete = (tasks: Task[], targetId: string): Task[] => {
  return tasks.filter(t => t.id !== targetId).map(task => ({
    ...task,
    subtasks: findTaskAndDelete(task.subtasks, targetId)
  }));
};

// Helper to reorder tasks (move draggedId to index of targetId)
const findAndReorderTask = (tasks: Task[], draggedId: string, targetId: string): Task[] => {
    // Check if both IDs exist at this level
    const draggedIndex = tasks.findIndex(t => t.id === draggedId);
    const targetIndex = tasks.findIndex(t => t.id === targetId);

    if (draggedIndex !== -1 && targetIndex !== -1) {
        // Reorder at this level
        const newTasks = [...tasks];
        const [movedTask] = newTasks.splice(draggedIndex, 1);
        // Calculate new index - if moving down, index shifts
        const newTargetIndex = newTasks.findIndex(t => t.id === targetId); 
        newTasks.splice(newTargetIndex, 0, movedTask);
        return newTasks;
    }

    // Recursively check children
    return tasks.map(task => {
        if (task.subtasks.length > 0) {
            return { ...task, subtasks: findAndReorderTask(task.subtasks, draggedId, targetId) };
        }
        return task;
    });
};

// --- COLOR THEMES ---
// Task Themes (Subtle)
const TASK_THEMES = [
  { name: 'Indigo', border: 'border-indigo-500/30', bg: 'bg-indigo-500/5', hover: 'hover:border-indigo-500/50', text: 'text-indigo-400' },
  { name: 'Emerald', border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', hover: 'hover:border-emerald-500/50', text: 'text-emerald-400' },
  { name: 'Rose', border: 'border-rose-500/30', bg: 'bg-rose-500/5', hover: 'hover:border-rose-500/50', text: 'text-rose-400' },
  { name: 'Amber', border: 'border-amber-500/30', bg: 'bg-amber-500/5', hover: 'hover:border-amber-500/50', text: 'text-amber-400' },
  { name: 'Cyan', border: 'border-cyan-500/30', bg: 'bg-cyan-500/5', hover: 'hover:border-cyan-500/50', text: 'text-cyan-400' },
];

// Project Themes (Strong)
const PROJECT_THEMES = [
    "bg-gradient-to-br from-[#1e1b4b] to-[#312e81] border-indigo-500/40 shadow-indigo-900/20",   // Indigo Strong
    "bg-gradient-to-br from-[#064e3b] to-[#065f46] border-emerald-500/40 shadow-emerald-900/20", // Emerald Strong
    "bg-gradient-to-br from-[#881337] to-[#9f1239] border-rose-500/40 shadow-rose-900/20",       // Rose Strong
    "bg-gradient-to-br from-[#451a03] to-[#78350f] border-amber-500/40 shadow-amber-900/20",     // Amber Strong
    "bg-gradient-to-br from-[#164e63] to-[#155e75] border-cyan-500/40 shadow-cyan-900/20",       // Cyan Strong
];

// --- CONTEXT ---
interface AppContextType {
  state: AppState;
  currentUser: User;
  activeProjectId: string | null;
  setActiveProjectId: (id: string | null) => void;
  addProject: (title: string, subtitle: string) => void;
  updateProject: (id: string, updates: Partial<Project>) => void; // Added
  deleteProject: (id: string) => void;
  logout: () => void;
  
  // Project Scoped Actions
  toggleTaskStatus: (taskId: string) => void;
  addTask: (parentId: string | null, title: string) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void; // Added
  deleteTask: (taskId: string) => void;
  moveTask: (draggedId: string, targetId: string) => void; 
  addActivity: (taskId: string, content: string, type: ActivityLog['type']) => void;
  addAttachment: (taskId: string, file: File) => void;
  toggleExpand: (taskId: string) => void;
  openTaskDetail: (task: Task) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  
  // UI Actions
  requestInput: (title: string, callback: (val: string) => void) => void;
  openAIModal: () => void;
  openStatsModal: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

// --- COMPONENTS ---

const IntroScreen: React.FC<{ onSelectUser: (u: User) => void }> = ({ onSelectUser }) => {
  return (
    <div className="fixed inset-0 z-50 bg-[#050505] flex flex-col items-center justify-center p-4">
      <div className="text-center mb-16">
         <h1 className="text-6xl md:text-8xl font-display font-medium text-white tracking-widest animate-cinematic bg-clip-text text-transparent bg-gradient-to-br from-white via-gray-200 to-gray-500">
           Proyectate
         </h1>
         <p className="text-gray-400 mt-4 font-sans font-light tracking-[0.2em] uppercase text-sm animate-fade-in" style={{ animationDelay: '1s' }}>
           Relajo con Orden
         </p>
      </div>

      <div className="flex gap-6 animate-slide-up" style={{ animationDelay: '1.2s' }}>
        {USERS.map(user => (
          <button
            key={user.id}
            onClick={() => onSelectUser(user)}
            className="group relative flex flex-col items-center gap-3 p-6 rounded-2xl bg-white/5 border border-white/10 hover:border-primary/50 hover:bg-white/10 transition-all duration-300 w-32"
          >
            <div className={`w-12 h-12 rounded-full ${user.avatarColor} flex items-center justify-center text-white font-bold text-xl shadow-lg group-hover:scale-110 transition-transform`}>
              {user.name.charAt(0)}
            </div>
            <span className="text-gray-300 font-medium group-hover:text-white">{user.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

const InputModal: React.FC<{ title: string; onClose: () => void; onSubmit: (val: string) => void }> = ({ title, onClose, onSubmit }) => {
    const [value, setValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if(inputRef.current) inputRef.current.focus();
    }, []);

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        if(value.trim()) {
            onSubmit(value);
            onClose();
        }
    }

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-[#0c0c0e] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
                <h3 className="text-xl font-display font-bold text-white mb-4">{title}</h3>
                <form onSubmit={handleSubmit}>
                    <input 
                        ref={inputRef}
                        type="text" 
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder="Escribe aquí..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50 mb-6"
                    />
                    <div className="flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white text-sm font-medium transition-colors">Cancelar</button>
                        <button type="submit" disabled={!value.trim()} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Crear</button>
                    </div>
                </form>
            </div>
        </div>
    )
}

// AI Modal
const AIModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [query, setQuery] = useState('');
    const [response, setResponse] = useState('');
    const [loading, setLoading] = useState(false);
    const ctx = useContext(AppContext);
    
    // Build context from active project
    const activeProject = ctx?.state.projects.find(p => p.id === ctx.activeProjectId);
    const contextStr = activeProject 
        ? `Proyecto Activo: ${activeProject.title} (${activeProject.subtitle}). Tareas actuales: ${activeProject.tasks.map(t => t.title).join(', ')}.` 
        : "Sin proyecto activo seleccionado en el dashboard.";

    const handleAsk = async () => {
        if(!query.trim()) return;
        setLoading(true);
        const res = await getStrategicAdvice(contextStr, query);
        setResponse(res);
        setLoading(false);
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-[#111115] border border-indigo-500/30 rounded-2xl w-full max-w-2xl p-6 shadow-2xl shadow-indigo-900/20 animate-slide-up flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-2xl font-display font-bold text-white flex items-center gap-3">
                        <Icons.Bot className="text-indigo-400" />
                        Consultor Estratégico
                    </h3>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-gray-400"><Icons.Close /></button>
                </div>

                <div className="flex-1 overflow-y-auto mb-6 pr-2">
                    {response ? (
                         <div className="prose prose-invert prose-sm max-w-none bg-white/5 p-4 rounded-xl border border-white/5">
                            {response.split('\n').map((line, i) => <p key={i} className="mb-2 last:mb-0">{line}</p>)}
                         </div>
                    ) : (
                        <div className="text-center py-12 text-gray-500">
                            <Icons.Bot className="w-12 h-12 mx-auto mb-3 opacity-20" />
                            <p>Modos: Inversor Escéptico, Analista Técnico (MSP/Niza) o Calculadora PYME.</p>
                            <p className="text-sm mt-2">"¿En qué proyecto trabajamos hoy: TAOASIS o GUTEN?"</p>
                        </div>
                    )}
                </div>

                <div className="relative">
                    <input 
                        type="text" 
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
                        placeholder="Ej: ¿Cuál es el Landed Cost de este producto?"
                        className="w-full bg-black/30 border border-white/10 rounded-xl py-4 pl-4 pr-12 text-white focus:outline-none focus:border-indigo-500/50"
                        disabled={loading}
                    />
                    <button 
                        onClick={handleAsk}
                        disabled={loading || !query.trim()}
                        className="absolute right-2 top-2 p-2 bg-indigo-600 rounded-lg text-white disabled:opacity-50 hover:bg-indigo-500 transition-colors"
                    >
                        {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <Icons.ArrowRight size={20} />}
                    </button>
                </div>
            </div>
        </div>
    )
}

// Stats Modal
const StatsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const ctx = useContext(AppContext);
    if (!ctx) return null;

    const totalProjects = ctx.state.projects.length;
    let totalTasks = 0;
    let completedTasks = 0;

    ctx.state.projects.forEach(p => {
        const countTasks = (tasks: Task[]) => {
            tasks.forEach(t => {
                totalTasks++;
                if (t.status === TaskStatus.COMPLETED) completedTasks++;
                countTasks(t.subtasks);
            });
        };
        countTasks(p.tasks);
    });

    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-[#111115] border border-emerald-500/30 rounded-2xl w-full max-w-lg p-8 shadow-2xl shadow-emerald-900/20 animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-8">
                    <h3 className="text-2xl font-display font-bold text-white flex items-center gap-3">
                        <Icons.Chart className="text-emerald-400" />
                        Estadísticas Globales
                    </h3>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-gray-400"><Icons.Close /></button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white/5 p-6 rounded-2xl border border-white/5 flex flex-col items-center justify-center">
                        <span className="text-4xl font-display font-bold text-white mb-2">{totalProjects}</span>
                        <span className="text-xs text-gray-400 uppercase tracking-widest">Proyectos</span>
                    </div>
                    <div className="bg-white/5 p-6 rounded-2xl border border-white/5 flex flex-col items-center justify-center">
                        <span className="text-4xl font-display font-bold text-emerald-400 mb-2">{completionRate}%</span>
                        <span className="text-xs text-gray-400 uppercase tracking-widest">Progreso Total</span>
                    </div>
                    <div className="bg-white/5 p-6 rounded-2xl border border-white/5 flex flex-col items-center justify-center col-span-2">
                        <div className="flex justify-between w-full mb-2 text-sm text-gray-300">
                            <span>Tareas Completadas</span>
                            <span className="font-mono">{completedTasks}/{totalTasks}</span>
                        </div>
                        <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${completionRate}%` }}></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

const ProgressRing: React.FC<{ progress: number; size?: number; stroke?: number; colorClass?: string }> = ({ progress, size = 32, stroke = 4, colorClass = 'text-primary' }) => {
  const radius = (size - stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;
  
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90 w-full h-full">
        <circle cx={size/2} cy={size/2} r={radius} stroke="currentColor" strokeWidth={stroke} fill="transparent" className="text-white/10" />
        <circle 
          cx={size/2} cy={size/2} r={radius} 
          stroke="currentColor" strokeWidth={stroke} fill="transparent" 
          strokeDasharray={circumference} strokeDashoffset={offset} 
          className={`transition-all duration-500 ease-out ${progress === 100 ? 'text-green-400' : colorClass}`}
          strokeLinecap="round"
        />
      </svg>
      {progress > 0 && progress < 100 && (
         <span className="absolute text-[10px] font-bold text-white">{progress}</span>
      )}
      {progress === 100 && <Icons.Check size={size/1.5} className="absolute text-green-400" />}
    </div>
  );
};

// TASK CARD
const TaskCard: React.FC<{ task: Task; depth: number; themeIndex: number }> = ({ task, depth, themeIndex }) => {
  const ctx = useContext(AppContext);
  const [isDragging, setIsDragging] = useState(false);
  const [isOver, setIsOver] = useState(false);

  if (!ctx) return null;

  const progress = getTaskProgress(task);
  const isLeaf = task.subtasks.length === 0;
  const hasAttachments = task.attachments.length > 0;
  const hasComments = task.activity.length > 1;

  // Permissions
  const isOwner = task.createdBy === ctx.currentUser.id;
  const owner = USERS.find(u => u.id === task.createdBy);

  const theme = TASK_THEMES[themeIndex % TASK_THEMES.length];
  
  const cardStyle = depth === 0 
    ? `${theme.bg} ${theme.border} hover:shadow-[0_0_15px_rgba(0,0,0,0.2)] ${theme.hover}`
    : `bg-white/[0.02] border-white/5 hover:bg-white/5 hover:border-white/10`;

  // Drag Handlers
  const handleDragStart = (e: React.DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.setData('taskId', task.id);
      setIsDragging(true);
  };

  const handleDragEnd = (e: React.DragEvent) => {
      e.stopPropagation();
      setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsOver(false);
      const draggedId = e.dataTransfer.getData('taskId');
      if (draggedId && draggedId !== task.id) {
          ctx.moveTask(draggedId, task.id);
      }
  };

  const handleStatusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOwner) {
        alert(`Solo ${owner?.name} puede completar esta tarea.`);
        return;
    }
    if (isLeaf) ctx.toggleTaskStatus(task.id);
  };

  const handleAddSubtask = (e: React.MouseEvent) => {
    e.stopPropagation();
    ctx.requestInput(`Agregar subtarea a "${task.title}"`, (title) => {
        ctx.addTask(task.id, title);
    });
  }

  return (
    <div 
        className={`
            relative group
            ${depth > 0 ? 'ml-6 pl-6 border-l border-white/5' : 'mb-6'}
            ${isDragging ? 'opacity-50' : 'opacity-100'}
            transition-all duration-300
        `}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
    > 
      {/* Connector */}
      {depth > 0 && <div className="absolute top-8 left-0 w-6 h-[1px] bg-white/5"></div>}

      <div 
        onClick={() => ctx.openTaskDetail(task)}
        className={`
          relative rounded-xl p-5 transition-all duration-300 cursor-pointer border backdrop-blur-sm
          ${cardStyle}
          ${isOver ? 'border-indigo-500 scale-[1.02] shadow-xl' : ''}
          ${task.status === TaskStatus.COMPLETED && isLeaf ? 'opacity-50 grayscale' : 'opacity-100'}
        `}
      >
        <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4 flex-1">
                {/* Visual Indicator */}
                <div onClick={handleStatusClick} className={`cursor-pointer transition-transform mt-1 ${isOwner ? 'hover:scale-110' : 'cursor-not-allowed opacity-50'}`}>
                {isLeaf ? (
                    task.status === TaskStatus.COMPLETED ? 
                    <div className="w-8 h-8 rounded-full bg-green-500/20 border border-green-500 flex items-center justify-center text-green-500"><Icons.Check size={20} /></div> :
                    <div className={`w-8 h-8 rounded-full border border-white/30 ${isOwner ? 'hover:border-white' : ''} flex items-center justify-center`}>
                        {!isOwner && <Icons.Lock size={12} className="text-gray-500" />}
                    </div>
                ) : (
                    <ProgressRing progress={progress} size={32} stroke={4} colorClass={theme.text} />
                )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <h3 className={`font-display font-medium text-xl truncate ${task.status === TaskStatus.COMPLETED ? 'line-through text-gray-500' : 'text-gray-100'}`}>
                        {task.title}
                        </h3>
                        {hasAttachments && <Icons.Link size={12} className={theme.text} />}
                        {hasComments && <div className={`w-1.5 h-1.5 rounded-full ${theme.bg.replace('/5','')} ${theme.text}`}></div>}
                    </div>
                    {task.description && <p className="text-sm text-gray-400 truncate mb-3">{task.description}</p>}
                    
                    <div className="flex items-center gap-3">
                         {/* Owner Badge */}
                        <div className="flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded text-[10px] text-gray-400 border border-white/5">
                            <div className={`w-1.5 h-1.5 rounded-full ${owner?.avatarColor}`}></div>
                            {owner?.name}
                        </div>

                        {/* Explicit Add Button */}
                        <button 
                            onClick={handleAddSubtask}
                            className={`
                                flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-lg
                                transition-colors duration-200
                                ${depth === 0 ? 'bg-black/20 text-gray-300 hover:text-white hover:bg-black/40' : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200'}
                            `}
                        >
                            <Icons.Add size={12} />
                            Agregar
                        </button>
                    </div>
                </div>
            </div>

            {/* Expand/Collapse */}
            {task.subtasks.length > 0 && (
                <button 
                    onClick={(e) => { e.stopPropagation(); ctx.toggleExpand(task.id); }} 
                    className="p-2 hover:bg-white/10 rounded-full text-gray-400 transition-colors"
                >
                {task.expanded ? <Icons.Collapse size={20} /> : <Icons.Expand size={20} />}
                </button>
            )}
        </div>
      </div>

      {/* Children */}
      {task.expanded && (
        <div className="mt-3">
           {task.subtasks.map(sub => (
             <TaskCard key={sub.id} task={sub} depth={depth + 1} themeIndex={themeIndex} />
           ))}
        </div>
      )}
    </div>
  );
};

// TASK DETAIL MODAL
const TaskDetailModal: React.FC<{ task: Task; onClose: () => void }> = ({ task, onClose }) => {
  const ctx = useContext(AppContext);
  const [comment, setComment] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  if (!ctx) return null;

  const isOwner = task.createdBy === ctx.currentUser.id;
  const owner = USERS.find(u => u.id === task.createdBy);

  const progress = getTaskProgress(task);
  const handlePostComment = () => {
    if (!comment.trim()) return;
    ctx.addActivity(task.id, comment, 'comment');
    setComment('');
  };

  // Editing Handlers
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      ctx.updateTask(task.id, { title: e.target.value });
  };
  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      ctx.updateTask(task.id, { description: e.target.value });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/80 backdrop-blur-md animate-fade-in" onClick={onClose}>
      <div className="w-full max-w-2xl bg-[#09090b] h-full border-l border-white/10 shadow-2xl overflow-hidden flex flex-col animate-slide-up" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="p-8 border-b border-white/10 bg-gradient-to-r from-void to-[#1a1a20] relative overflow-hidden">
            {/* Ambient Glow */}
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-indigo-500/20 rounded-full blur-3xl"></div>
          
            <div className="flex justify-between items-start mb-6 relative z-10">
                <div className="flex flex-col gap-1 flex-1 mr-4">
                    {/* Editable Title */}
                    <input 
                        type="text" 
                        value={task.title} 
                        onChange={handleTitleChange}
                        className="text-3xl font-display font-bold text-white leading-tight bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50 rounded-lg w-full placeholder-gray-600"
                    />
                    
                    <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-gray-500 uppercase tracking-widest">Creado por:</span>
                        <div className="flex items-center gap-2 bg-white/5 px-2 py-1 rounded-full border border-white/5">
                            <div className={`w-4 h-4 rounded-full ${owner?.avatarColor}`}></div>
                            <span className="text-xs text-gray-300 font-medium">{owner?.name}</span>
                        </div>
                        {!isOwner && <Icons.Lock size={14} className="text-gray-500 ml-1" />}
                    </div>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-gray-400 transition-colors"><Icons.Close size={24} /></button>
            </div>
            
            <div className="flex items-center gap-4 relative z-10">
                <ProgressRing progress={progress} size={48} stroke={5} />
                <div>
                    <span className="text-white font-mono text-xl font-bold">{progress}%</span>
                    <p className="text-xs text-gray-500 uppercase tracking-widest">Completado</p>
                </div>
            </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
           {/* Description */}
           <div>
             <h3 className="text-sm uppercase tracking-widest text-gray-500 mb-3 flex items-center gap-2 font-bold"><Icons.Book size={14}/> Descripción</h3>
             <div className="bg-white/5 p-5 rounded-xl border border-white/5 text-gray-300 min-h-[80px]">
                {/* Editable Description */}
                <textarea 
                    value={task.description || ''} 
                    onChange={handleDescriptionChange}
                    placeholder="Añade una descripción detallada..."
                    className="w-full h-full bg-transparent border-none focus:outline-none text-gray-300 resize-none placeholder-gray-600"
                    rows={3}
                />
             </div>
           </div>

           {/* Subtasks Management in Modal */}
           <div>
               <div className="flex justify-between items-center mb-3">
                    <h3 className="text-sm uppercase tracking-widest text-gray-500 flex items-center gap-2 font-bold"><Icons.Check size={14}/> Subtareas</h3>
                    <button 
                        onClick={() => ctx.requestInput(`Nueva subtarea para ${task.title}`, (t) => ctx.addTask(task.id, t))}
                        className="text-xs bg-indigo-600/20 text-indigo-400 hover:bg-indigo-600/40 border border-indigo-500/30 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2"
                    >
                        <Icons.Add size={14} /> Crear Subtarea
                    </button>
               </div>
               
               <div className="space-y-2">
                   {task.subtasks.length > 0 ? (
                       task.subtasks.map(sub => (
                           <div key={sub.id} className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/5">
                               <div className="flex items-center gap-3">
                                   <div className={`w-2 h-2 rounded-full ${sub.status === TaskStatus.COMPLETED ? 'bg-green-500' : 'bg-gray-600'}`}></div>
                                   <span className={`text-sm ${sub.status === TaskStatus.COMPLETED ? 'line-through text-gray-500' : 'text-gray-300'}`}>{sub.title}</span>
                               </div>
                               <button onClick={() => ctx.openTaskDetail(sub)} className="p-1 hover:text-white text-gray-500"><Icons.ArrowRight size={14} /></button>
                           </div>
                       ))
                   ) : (
                       <div className="text-center py-4 border border-dashed border-white/10 rounded-lg text-gray-600 text-sm">No hay subtareas</div>
                   )}
               </div>
           </div>

           {/* Attachments */}
           <div>
             <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm uppercase tracking-widest text-gray-500 flex items-center gap-2 font-bold"><Icons.Link size={14}/> Archivos</h3>
                <button onClick={() => fileInputRef.current?.click()} className="text-xs bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg text-white transition-colors">+ Adjuntar</button>
                <input type="file" ref={fileInputRef} className="hidden" onChange={(e) => { if (e.target.files?.[0]) ctx.addAttachment(task.id, e.target.files[0]); }} />
             </div>
             <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
               {task.attachments.map(att => {
                   const attOwner = USERS.find(u => u.id === att.createdBy);
                   return (
                    <a key={att.id} href={att.url} target="_blank" className="block p-3 bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg transition-colors group relative overflow-hidden">
                        <div className="mb-2 text-gray-400 group-hover:text-white"><Icons.File size={20} /></div>
                        <div className="text-xs truncate text-gray-500 group-hover:text-white relative z-10">{att.name}</div>
                        <div className={`absolute top-2 right-2 w-2 h-2 rounded-full ${attOwner?.avatarColor}`}></div>
                    </a>
                   )
               })}
               {task.attachments.length === 0 && <p className="text-sm text-gray-600 col-span-3 italic">No hay archivos adjuntos.</p>}
             </div>
           </div>

           {/* Activity Log */}
           <div>
             <h3 className="text-sm uppercase tracking-widest text-gray-500 mb-4 flex items-center gap-2 font-bold"><Icons.Chart size={14}/> Bitácora & Comentarios</h3>
             <div className="flex gap-3 mb-6">
               <div className={`w-8 h-8 rounded-full ${ctx.currentUser.avatarColor} flex items-center justify-center text-xs font-bold text-white shrink-0 shadow-lg`}>
                   {ctx.currentUser.name.charAt(0)}
               </div>
               <div className="flex-1">
                 <textarea 
                   value={comment} onChange={(e) => setComment(e.target.value)} placeholder={`Escribe algo, ${ctx.currentUser.name}...`}
                   className="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-white focus:outline-none focus:border-white/30 min-h-[80px] text-sm"
                   onKeyDown={(e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePostComment(); } }}
                 />
                 <div className="flex justify-end mt-2">
                   <button onClick={handlePostComment} className="bg-white/10 hover:bg-white/20 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors">Guardar</button>
                 </div>
               </div>
             </div>

             <div className="space-y-6 relative before:absolute before:left-4 before:top-0 before:bottom-0 before:w-[1px] before:bg-white/10">
               {task.activity.slice().reverse().map(log => {
                 const logUser = USERS.find(u => u.id === log.createdBy) || USERS[0];
                 return (
                    <div key={log.id} className="relative pl-10 animate-fade-in">
                        <div className={`absolute left-2.5 top-1.5 w-3 h-3 rounded-full border-2 border-[#09090b] ${log.type === 'comment' ? 'bg-primary' : 'bg-gray-500'} shadow-[0_0_10px_rgba(255,255,255,0.2)]`}></div>
                        <div className="flex flex-col">
                            <div className="flex items-center gap-2 mb-1">
                                <span className={`text-xs font-bold ${logUser.id === 'u-leticia' ? 'text-rose-400' : 'text-blue-400'}`}>{logUser.name}</span>
                                <span className="text-[10px] text-gray-500">{new Date(log.timestamp).toLocaleString()}</span>
                            </div>
                            <div className="text-sm text-gray-300 bg-white/5 p-3 rounded-lg border border-white/5">{log.content}</div>
                        </div>
                    </div>
                 );
               })}
             </div>
           </div>
        </div>
        
        {/* Actions Footer */}
        <div className="p-4 border-t border-white/10 bg-black/40 flex justify-between items-center">
            {isOwner ? (
                <button onClick={() => { if(confirm("¿Eliminar tarea y contenido?")) { ctx.deleteTask(task.id); onClose(); } }} className="text-red-500 text-sm hover:underline flex items-center gap-2 hover:bg-red-500/10 px-3 py-1.5 rounded-lg transition-colors">
                    <Icons.Delete size={14} /> Eliminar Tarea
                </button>
            ) : (
                <span className="text-xs text-gray-600 flex items-center gap-2"><Icons.Lock size={12}/> Solo el propietario puede eliminar</span>
            )}
        </div>
      </div>
    </div>
  );
};

// PROJECT LIST VIEW (HOME)
const ProjectsList: React.FC = () => {
    const ctx = useContext(AppContext);
    if(!ctx) return null;

    const handleCreate = () => {
        ctx.requestInput("Nombre del Nuevo Proyecto", (title) => {
            ctx.addProject(title, "Proyecto de Inversión");
        });
    }

    return (
        <div className="p-8 max-w-6xl mx-auto">
            {/* Header User Badge */}
            <div className="flex justify-end mb-8">
                <div className="flex items-center gap-4 bg-white/5 pl-4 pr-6 py-2 rounded-full border border-white/10 hover:border-white/30 transition-colors">
                    {/* Tools Area - Tirones */}
                    <div className="flex items-center gap-2 border-r border-white/10 pr-4">
                        <button onClick={ctx.openStatsModal} className="p-2 bg-emerald-500/10 text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition-all hover:scale-105" title="Estadísticas">
                            <Icons.Chart size={18} />
                        </button>
                        <button onClick={ctx.openAIModal} className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg hover:bg-indigo-500/20 transition-all hover:scale-105" title="Asesor Virtual">
                            <Icons.Bot size={18} />
                        </button>
                    </div>
                    
                    <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full ${ctx.currentUser.avatarColor} flex items-center justify-center text-white font-bold shadow-lg`}>
                            {ctx.currentUser.name.charAt(0)}
                        </div>
                        <span className="text-sm font-medium text-gray-300">{ctx.currentUser.name}</span>
                    </div>
                    
                    <button onClick={ctx.logout} className="text-xs text-red-400 hover:text-red-300 ml-2 border-l border-white/10 pl-4">Salir</button>
                </div>
            </div>

            <div className="mb-12 text-center">
                <h1 className="text-6xl md:text-8xl font-display font-medium text-white mb-4 tracking-widest drop-shadow-2xl">Proyectate</h1>
                <p className="text-xl text-gray-400 font-sans font-light tracking-[0.2em] uppercase">Relajo con Orden</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {ctx.state.projects.map((project, index) => {
                    const progress = getProjectProgress(project);
                    const creator = USERS.find(u => u.id === project.createdBy);
                    const themeClass = PROJECT_THEMES[index % PROJECT_THEMES.length];
                    const isOwner = ctx.currentUser.id === project.createdBy;
                    
                    return (
                        <div 
                            key={project.id} 
                            onClick={() => ctx.setActiveProjectId(project.id)}
                            className={`
                                group relative border rounded-2xl p-6 cursor-pointer 
                                transition-all duration-300 hover:scale-[1.02] 
                                ${themeClass}
                                flex flex-col h-64 justify-between
                            `}
                        >
                             {/* Delete Button (Visible on Hover for Owner) */}
                            {isOwner && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); if(confirm("¿Eliminar proyecto completo?")) ctx.deleteProject(project.id); }}
                                    className="absolute top-4 right-4 p-2 bg-black/20 hover:bg-red-500/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                >
                                    <Icons.Delete size={16} />
                                </button>
                            )}

                            {/* Main Content: Vertically Centered */}
                            <div className="flex-1 flex items-center justify-between">
                                <div className="flex flex-col justify-center">
                                    <h3 className="text-3xl font-display font-bold text-white mb-1 drop-shadow-md leading-tight">{project.title}</h3>
                                    <p className="text-sm text-gray-200/70 uppercase tracking-wider font-medium">{project.subtitle}</p>
                                </div>
                                <div className="flex items-center justify-center pl-4">
                                     <ProgressRing progress={progress} size={64} stroke={6} />
                                </div>
                            </div>

                            {/* Footer */}
                            <div className="mt-2 pt-4 border-t border-white/10 flex justify-between items-center text-sm text-gray-200/60">
                                <span className="flex items-center gap-2">
                                    <div className={`w-3 h-3 rounded-full ${creator?.avatarColor} shadow-md`}></div>
                                    <span className="font-semibold">{creator?.name}</span>
                                </span>
                                <span className="group-hover:translate-x-1 transition-transform bg-white/10 p-2 rounded-full"><Icons.ArrowRight size={16} className="text-white" /></span>
                            </div>
                        </div>
                    )
                })}

                {/* Create New Project Card */}
                <div 
                    onClick={handleCreate}
                    className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-white/10 rounded-2xl cursor-pointer hover:border-white/30 hover:bg-white/5 transition-all group"
                >
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-gray-400 group-hover:scale-110 group-hover:bg-white/10 transition-all mb-4">
                        <Icons.Add size={32} />
                    </div>
                    <span className="font-medium text-gray-300 group-hover:text-white">Crear Nuevo Proyecto</span>
                </div>
            </div>
        </div>
    )
}

// PROJECT DETAIL VIEW
const ProjectView: React.FC = () => {
    const ctx = useContext(AppContext);
    if(!ctx || !ctx.activeProjectId) return null;

    const project = ctx.state.projects.find(p => p.id === ctx.activeProjectId);
    if(!project) return null;

    const visibleTasks = useMemo(() => {
        if (!ctx.searchQuery.trim()) return project.tasks;
        return searchTasks(project.tasks, ctx.searchQuery);
    }, [project.tasks, ctx.searchQuery]);

    // Editing Project Header
    const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        ctx.updateProject(project.id, { title: e.target.value });
    }
    const handleSubtitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        ctx.updateProject(project.id, { subtitle: e.target.value });
    }

    return (
        <div className="max-w-5xl mx-auto px-4 sm:px-8 mt-8 pb-20">
            {/* Nav Header */}
            <div className="flex items-center gap-4 mb-8">
                <button 
                    onClick={() => ctx.setActiveProjectId(null)} 
                    className="p-2 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
                >
                    <Icons.ArrowRight className="rotate-180" />
                </button>
                <div className="flex-1">
                    <input 
                        type="text" 
                        value={project.title} 
                        onChange={handleTitleChange}
                        className="text-4xl font-display font-bold text-white bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50 rounded-lg w-full"
                    />
                    <input 
                        type="text" 
                        value={project.subtitle} 
                        onChange={handleSubtitleChange}
                        className="text-indigo-400 text-sm font-sans tracking-wider bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-indigo-500/50 rounded-lg w-full mt-1"
                    />
                </div>
                
                {/* User & Tools */}
                <div className="flex items-center gap-3 bg-white/5 pl-2 pr-4 py-2 rounded-full border border-white/10 shrink-0">
                    <div className="flex items-center gap-2 mr-2 border-r border-white/10 pr-4">
                        <button onClick={ctx.openStatsModal} className="text-gray-400 hover:text-emerald-400 transition-colors">
                            <Icons.Chart size={18} />
                        </button>
                        <button onClick={ctx.openAIModal} className="text-gray-400 hover:text-indigo-400 transition-colors">
                            <Icons.Bot size={18} />
                        </button>
                    </div>
                    
                    <div className={`w-8 h-8 rounded-full ${ctx.currentUser.avatarColor} flex items-center justify-center text-white font-bold shadow-lg`}>
                        {ctx.currentUser.name.charAt(0)}
                    </div>
                </div>
            </div>
            
            {/* Search Bar */}
            <div className="relative w-full mb-8">
                <input 
                    type="text" 
                    value={ctx.searchQuery}
                    onChange={(e) => ctx.setSearchQuery(e.target.value)}
                    placeholder="Buscar en el proyecto..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl py-4 pl-12 pr-4 text-white focus:outline-none focus:border-indigo-500/50 shadow-inner"
                />
                <Icons.Chart className="absolute left-4 top-4.5 text-gray-500 w-5 h-5" />
            </div>

            <div className="flex justify-between items-center mb-6">
                 <h2 className="text-lg font-medium text-gray-400 font-display">Fases del Proyecto</h2>
                 <button 
                   onClick={() => ctx.requestInput("Nueva Fase del Proyecto", (t) => ctx.addTask(null, t))}
                   className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-full text-sm font-bold transition-colors flex items-center gap-2 shadow-lg shadow-indigo-900/40"
                 >
                   <Icons.Add size={16} /> Agregar Fase
                 </button>
            </div>

            <div className="space-y-6">
                {visibleTasks.map((task, index) => (
                    <TaskCard key={task.id} task={task} depth={0} themeIndex={index} />
                ))}
                {visibleTasks.length === 0 && (
                    <div className="text-center py-20 bg-white/5 rounded-2xl border border-white/5 border-dashed">
                       <p className="text-gray-500">Este proyecto aún no tiene fases definidas.</p>
                    </div>
                )}
            </div>
        </div>
    )
}

// --- APP ENTRY ---
const App: React.FC = () => {
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem('proyectate_app_state');
    return saved ? JSON.parse(saved) : INITIAL_APP_STATE;
  });
  
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal State
  const [modalConfig, setModalConfig] = useState<{title: string, callback: (val: string) => void} | null>(null);
  const [showAI, setShowAI] = useState(false);
  const [showStats, setShowStats] = useState(false);

  useEffect(() => {
    localStorage.setItem('proyectate_app_state', JSON.stringify(state));
  }, [state]);

  const requestInput = useCallback((title: string, callback: (val: string) => void) => {
      setModalConfig({ title, callback });
  }, []);

  // Project Actions
  const addProject = useCallback((title: string, subtitle: string) => {
      if(!currentUser) return;
      const newProject: Project = {
          id: generateId(), title, subtitle, createdAt: Date.now(), createdBy: currentUser.id, tasks: []
      };
      setState(prev => ({ ...prev, projects: [...prev.projects, newProject] }));
  }, [currentUser]);

  const deleteProject = useCallback((id: string) => {
      setState(prev => ({ ...prev, projects: prev.projects.filter(p => p.id !== id) }));
  }, []);

  const modifyActiveProject = useCallback((updater: (p: Project) => Project) => {
      if(!activeProjectId) return;
      setState(prev => ({
          projects: prev.projects.map(p => p.id === activeProjectId ? updater(p) : p)
      }));
  }, [activeProjectId]);

  const updateProject = useCallback((id: string, updates: Partial<Project>) => {
      setState(prev => ({
          projects: prev.projects.map(p => p.id === id ? { ...p, ...updates } : p)
      }));
  }, []);

  const addTask = useCallback((parentId: string | null, title: string) => {
    if(!currentUser) return;
    const newTask: Task = {
      id: generateId(),
      title,
      status: TaskStatus.PENDING,
      attachments: [], tags: [], subtasks: [], expanded: true,
      createdBy: currentUser.id,
      activity: [{ id: generateId(), type: 'creation', content: 'Creado', timestamp: Date.now(), createdBy: currentUser.id }]
    };

    modifyActiveProject(p => {
        if(!parentId) return { ...p, tasks: [...p.tasks, newTask] };
        return { ...p, tasks: findTaskAndAddSubtask(p.tasks, parentId, newTask) };
    });
  }, [modifyActiveProject, currentUser]);

  const updateTask = useCallback((taskId: string, updates: Partial<Task>) => {
      modifyActiveProject(p => ({
          ...p,
          tasks: findTaskAndUpdate(p.tasks, taskId, t => ({ ...t, ...updates }))
      }));
  }, [modifyActiveProject]);

  const moveTask = useCallback((draggedId: string, targetId: string) => {
      modifyActiveProject(p => ({
          ...p,
          tasks: findAndReorderTask(p.tasks, draggedId, targetId)
      }));
  }, [modifyActiveProject]);

  const toggleTaskStatus = useCallback((taskId: string) => {
      modifyActiveProject(p => {
          const getStatus = (tasks: Task[]): TaskStatus | null => {
            for (const t of tasks) {
              if (t.id === taskId) return t.status;
              const sub = getStatus(t.subtasks);
              if (sub) return sub;
            }
            return null;
          };
          
          const currentStatus = getStatus(p.tasks);
          if (!currentStatus) return p;

          const newStatus = currentStatus === TaskStatus.COMPLETED ? TaskStatus.PENDING : TaskStatus.COMPLETED;
          const statusText = newStatus === TaskStatus.COMPLETED ? 'Completó la tarea' : 'Reabrió la tarea';
          
          // Add activity log
          const log: ActivityLog = { id: generateId(), type: 'status_change', content: statusText, timestamp: Date.now(), createdBy: currentUser!.id };

          return { 
              ...p, 
              tasks: findTaskAndUpdate(p.tasks, taskId, t => ({ 
                  ...t, 
                  status: newStatus,
                  activity: [...t.activity, log]
              })) 
          };
      });
  }, [modifyActiveProject, currentUser]);

  const deleteTask = useCallback((taskId: string) => {
      modifyActiveProject(p => ({ ...p, tasks: findTaskAndDelete(p.tasks, taskId) }));
  }, [modifyActiveProject]);

  const addActivity = useCallback((taskId: string, content: string, type: ActivityLog['type']) => {
      if(!currentUser) return;
      modifyActiveProject(p => ({ 
          ...p, 
          tasks: findTaskAndUpdate(p.tasks, taskId, t => ({ ...t, activity: [...t.activity, { id: generateId(), type, content, timestamp: Date.now(), createdBy: currentUser.id }] })) 
      }));
  }, [modifyActiveProject, currentUser]);

  const addAttachment = useCallback((taskId: string, file: File) => {
      if(!currentUser) return;
      const att: Attachment = { id: generateId(), name: file.name, type: 'document', url: URL.createObjectURL(file), createdAt: Date.now(), createdBy: currentUser.id };
      modifyActiveProject(p => ({
          ...p,
          tasks: findTaskAndUpdate(p.tasks, taskId, t => ({ ...t, attachments: [...t.attachments, att] }))
      }));
  }, [modifyActiveProject, currentUser]);

  const toggleExpand = useCallback((taskId: string) => {
      modifyActiveProject(p => ({ ...p, tasks: findTaskAndUpdate(p.tasks, taskId, t => ({ ...t, expanded: !t.expanded })) }));
  }, [modifyActiveProject]);

  // Auth Guard
  if (!currentUser) {
      return <IntroScreen onSelectUser={setCurrentUser} />;
  }

  return (
    <AppContext.Provider value={{ 
      state, currentUser, activeProjectId, setActiveProjectId, addProject, updateProject, deleteProject, logout: () => setCurrentUser(null),
      addTask, toggleTaskStatus, updateTask, deleteTask, addActivity, addAttachment, toggleExpand, moveTask,
      openTaskDetail: setActiveTask, searchQuery, setSearchQuery, requestInput,
      openAIModal: () => setShowAI(true), openStatsModal: () => setShowStats(true)
    }}>
      <div className="min-h-screen bg-[#050505] text-gray-200 font-sans selection:bg-indigo-500/30">
        
        {/* Background Ambience */}
        <div className="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
          <div className="absolute top-[-10%] left-[-10%] w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[120px] animate-blob"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-[120px] animate-blob" style={{ animationDelay: '5s' }}></div>
        </div>

        <main className="relative z-10">
            {activeProjectId ? <ProjectView /> : <ProjectsList />}
        </main>

        {/* Global Input Modal */}
        {modalConfig && (
            <InputModal 
                title={modalConfig.title} 
                onClose={() => setModalConfig(null)} 
                onSubmit={(val) => { modalConfig.callback(val); setModalConfig(null); }} 
            />
        )}

        {/* Global Tools Modals */}
        {showAI && <AIModal onClose={() => setShowAI(false)} />}
        {showStats && <StatsModal onClose={() => setShowStats(false)} />}

        {/* Detail Modal */}
        {activeTask && activeProjectId && (
          <TaskDetailModal 
            task={state.projects.find(p => p.id === activeProjectId)?.tasks.reduce((found: Task | undefined, t) => {
                 if(found) return found;
                 const search = (list: Task[]): Task | undefined => {
                     for(const item of list) { if(item.id === activeTask.id) return item; const res = search(item.subtasks); if(res) return res; }
                 }
                 return search([t]); 
            }, undefined) || (
                 (() => {
                     const p = state.projects.find(proj => proj.id === activeProjectId);
                     if(!p) return activeTask;
                     const search = (list: Task[]): Task | undefined => {
                         for(const item of list) { if(item.id === activeTask.id) return item; const res = search(item.subtasks); if(res) return res; }
                     }
                     return search(p.tasks) || activeTask;
                 })()
            )} 
            onClose={() => setActiveTask(null)} 
          />
        )}
      </div>
    </AppContext.Provider>
  );
};

export default App;