import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Exam, ExamAssignment, SubmissionStatus, StudentSubmission, Role, EngineeringDepartment, QuestionType } from '../types';
import { useAuth } from '../context/AuthContext';
import TakeExam from './TakeExam';
import Certificate from './Certificate';
import ResultsPage from './ResultsPage';

interface StudentDashboardProps {
    exams: Exam[];
}

const PASSING_PERCENTAGE = 70;

const StudentDashboard: React.FC<StudentDashboardProps> = ({ exams: initialExams }) => {
    const { user, logout } = useAuth();
    const [exams, setExams] = useState<Exam[]>([]);
    const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
    const [viewingCertificate, setViewingCertificate] = useState<{ exam: Exam, submission: StudentSubmission } | null>(null);
    const [viewingResults, setViewingResults] = useState<{ exam: Exam, submission: StudentSubmission } | null>(null);

    const [assignments, setAssignments] = useState<ExamAssignment[]>([]);

    // Fetch data function that can be called on mount and when returning to dashboard
    const fetchData = useCallback(async () => {
        if (!user) return;

        console.log('fetchData called - refreshing dashboard data...');

        const token = localStorage.getItem('access_token');
        const headers = { 'Authorization': `Bearer ${token}` };

        try {
            // Fetch Exams
            const examRes = await fetch('/api/exams/', { headers });
            if (examRes.ok) {
                const examData = await examRes.json();
                const examList = Array.isArray(examData) ? examData : (examData.results || []);
                const mappedExams: Exam[] = examList.map((e: any) => ({
                    id: e.id,
                    title: e.title,
                    durationMinutes: e.duration_minutes,
                    retakeLimit: e.retake_limit,
                    // Create placeholder questions array with correct count for display
                    questions: Array.from({ length: e.question_count || 0 }, (_, i) => ({
                        id: `placeholder-${i}`,
                        text: '',
                        questionType: QuestionType.ShortAnswer,
                        points: 0,
                        orderIndex: i
                    })),
                    instructorId: e.instructor.id,
                    instructorName: `${e.instructor.first_name} ${e.instructor.last_name}`,
                    department: e.specialization?.name as EngineeringDepartment
                }));
                setExams(mappedExams);
                console.log('Exams refreshed:', mappedExams.length);
            }

            // Fetch Assignments (Submissions)
            const subRes = await fetch('/api/submissions/exam_assignments/', { headers });
            if (subRes.ok) {
                const subData = await subRes.json();
                const assignmentsList = Array.isArray(subData) ? subData : (subData.results || []);
                setAssignments(assignmentsList);
                console.log('Assignments refreshed:', assignmentsList.length);
            }
        } catch (e) {
            console.error("Failed to fetch data", e);
        }
    }, [user]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const departmentalExams = useMemo(() => {
        if (!user || user.role !== Role.Student || !user.department) {
            return [];
        }
        return exams.filter(exam => exam.department === user.department);
    }, [exams, user]);

    const getSubmissionStatus = (examId: string): { status: string; submission: StudentSubmission | null } => {
        const assignment = assignments.find(a => a.exam.id === examId); // Backend serializer returns nested exam object

        if (!assignment) return { status: 'Not Started', submission: null };

        // Map assignment to StudentSubmission format expected by components
        // Calculate maxScore from exam questions
        // Use assignment.exam (which has full data) instead of exams array (which might not have questions)
        const maxScore = assignment.exam?.questions
            ? assignment.exam.questions.reduce((sum: number, q: any) => sum + parseFloat(q.points || 0), 0)
            : 100;

        const submission: StudentSubmission = {
            responses: {}, // We might not have responses in list view, but that's ok for status
            timeTaken: assignment.time_taken_seconds || 0,
            retakeCount: assignment.retake_count,
            score: parseFloat(assignment.score as any) || 0,
            maxScore: maxScore,
            submissionDate: new Date(assignment.submitted_at || assignment.created_at).toLocaleDateString()
        };

        const percentage = submission.maxScore > 0 ? (submission.score / submission.maxScore) * 100 : 0;
        console.log('Pass/Fail Calculation:', {
            examId,
            score: submission.score,
            maxScore: submission.maxScore,
            percentage,
            passingPercentage: PASSING_PERCENTAGE,
            passed: percentage >= PASSING_PERCENTAGE,
            assignmentStatus: assignment.status,
            examHasQuestions: !!assignment.exam?.questions
        });
        const passed = percentage >= PASSING_PERCENTAGE;

        // Status mapping
        // Backend status: not_started, in_progress, submitted, graded
        if (assignment.status === 'not_started') return { status: 'Not Started', submission: null };
        if (assignment.status === 'in_progress') return { status: 'In Progress', submission }; // Or 'Resume'
        if (assignment.status === 'submitted') return { status: 'Submitted (Pending Grade)', submission };
        if (assignment.status === 'graded') {
            if (passed) return { status: 'Passed', submission };
            if (assignment.exam && assignment.retake_count < assignment.exam.retake_limit) return { status: 'Failed, Retake available', submission };
            return { status: 'Completed (Failed)', submission };
        }

        return { status: 'Not Started', submission: null };
    }

    if (viewingCertificate && user) {
        return <Certificate
            studentName={user.firstName}
            examTitle={viewingCertificate.exam.title}
            completionDate={viewingCertificate.submission.submissionDate}
            onBack={() => setViewingCertificate(null)}
        />
    }

    if (viewingResults) {
        return <ResultsPage
            exam={viewingResults.exam}
            responses={viewingResults.submission.responses}
            timeTaken={viewingResults.submission.timeTaken}
            retakeCount={viewingResults.submission.retakeCount}
            onBackToDashboard={() => {
                setViewingResults(null);
                fetchData(); // Refetch to get updated scores
            }}
            onRetake={() => {
                setViewingResults(null);
                setSelectedExam(viewingResults.exam);
            }}
            onViewCertificate={() => {
                setViewingResults(null);
                setViewingCertificate({ exam: viewingResults.exam, submission: viewingResults.submission });
            }}
        />
    }

    if (selectedExam) {
        return <TakeExam exam={selectedExam} onBackToDashboard={() => {
            setSelectedExam(null);
            fetchData(); // Refetch to get updated scores
        }} />
    }

    return (
        <div className="p-4 sm:p-6 lg:p-8 flex flex-col min-h-screen">
            <header className="flex-shrink-0 bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4 mb-6 flex items-center justify-between">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold text-white truncate">Exams for {user?.department}</h1>
                    <p className="text-sm text-gray-400 mt-1">Welcome, {user?.firstName}</p>
                </div>
                <button onClick={logout} className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 text-white font-semibold transition">
                    Logout
                </button>
            </header>

            <main className="flex-grow overflow-y-auto">
                {departmentalExams.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {departmentalExams.map(exam => {
                            const { status, submission } = getSubmissionStatus(exam.id);
                            return (
                                <div key={exam.id} className="bg-gray-800 rounded-lg shadow-lg p-6 flex flex-col justify-between border border-gray-700">
                                    <div>
                                        <h2 className="text-xl font-bold text-white mb-2">{exam.title}</h2>
                                        <p className="text-sm text-gray-400 mb-4">By {exam.instructorName}</p>
                                        <div className="text-sm text-gray-300 space-y-2">
                                            <p><strong>Duration:</strong> {exam.durationMinutes} minutes</p>
                                            <p><strong>Questions:</strong> {exam.questions.length}</p>
                                            <p><strong>Status:</strong> <span className={`font - semibold ${status === 'Passed' ? 'text-green-400' : status.startsWith('Failed') ? 'text-yellow-400' : 'text-gray-400'} `}>{status}</span></p>
                                        </div>
                                    </div>
                                    <div className="mt-6 w-full space-y-2">
                                        {status === 'Not Started' && (
                                            <button
                                                onClick={() => setSelectedExam(exam)}
                                                className="w-full px-4 py-2 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-bold transition shadow-lg"
                                            >
                                                Start Exam
                                            </button>
                                        )}
                                        {status === 'Passed' && submission && (
                                            <>
                                                <button onClick={() => setViewingResults({ exam, submission })} className="w-full px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 text-white font-semibold">View Results</button>
                                                <button onClick={() => setViewingCertificate({ exam, submission })} className="w-full px-4 py-2 rounded-md bg-yellow-600 hover:bg-yellow-500 text-white font-bold">View Certificate</button>
                                            </>
                                        )}
                                        {status === 'Failed, Retake available' && submission && (
                                            <>
                                                <button onClick={() => setViewingResults({ exam, submission })} className="w-full px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 text-white font-semibold">View Results</button>
                                                <button onClick={() => setSelectedExam(exam)} className="w-full px-4 py-2 rounded-md bg-sky-600 hover:bg-sky-500 text-white font-bold">Retake Exam</button>
                                            </>
                                        )}
                                        {status === 'Completed (Failed)' && submission && (
                                            <button onClick={() => setViewingResults({ exam, submission })} className="w-full px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 text-white font-semibold">View Results</button>
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                ) : (
                    <div className="text-center py-20 text-gray-500">
                        <h2 className="text-2xl font-semibold">No Exams Available</h2>
                        <p className="mt-2">There are currently no exams scheduled for the {user?.department} department.</p>
                    </div>
                )}
            </main>
        </div>
    );
};

export default StudentDashboard;