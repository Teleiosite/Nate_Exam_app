import React, { useState, useMemo, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import CreateExamPage from './CreateExamPage';
import GradingPage from './GradingPage';
import { Exam, ExamAssignment, QuestionBank, QuestionType, SubmissionStatus, EngineeringDepartment, User, Role, EngineeringSpecialization } from '../types';

type View = 'builder' | 'grading';
type Tab = 'exams' | 'students';

const mockQuestionBank: QuestionBank = [
  { id: 'qb1', text: 'What is JSX?', questionType: QuestionType.ShortAnswer, points: 5, orderIndex: 0 },
  { id: 'qb2', text: 'React components must be pure functions.', questionType: QuestionType.MultipleChoice, options: [{ id: 'qb2o1', text: 'True', isCorrect: true }, { id: 'qb2o2', text: 'False' }], correctAnswer: 'qb2o1', points: 3, orderIndex: 1 },
  { id: 'qb3', text: 'How do you pass data from a parent to a child component?', questionType: QuestionType.ShortAnswer, points: 5, correctAnswer: 'props', orderIndex: 2 },
  { id: 'qb4', text: 'What does `useState` return?', questionType: QuestionType.MultipleChoice, options: [{ id: 'qb4o1', text: 'A state value and a function to update it', isCorrect: true }, { id: 'qb4o2', text: 'Only the state value' }], correctAnswer: 'qb4o1', points: 5, orderIndex: 3 },
];

const InstructorDashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const [selectedExam, setSelectedExam] = useState<Exam | null>(null);
  const [myExams, setMyExams] = useState<Exam[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<ExamAssignment[]>([]);
  const [isCreatingExam, setIsCreatingExam] = useState(false);
  const [editingExam, setEditingExam] = useState<Exam | null>(null);
  const [viewingExam, setViewingExam] = useState<Exam | null>(null);
  const [showGrading, setShowGrading] = useState(false);
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [view, setView] = useState<View>('builder');
  const [currentTab, setCurrentTab] = useState<Tab>('exams');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [questionBank, setQuestionBank] = useState<QuestionBank>(mockQuestionBank);
  const [specializations, setSpecializations] = useState<EngineeringSpecialization[]>([]);
  const [allStudents, setAllStudents] = useState<User[]>([]);

  // Fetch exams from API and update myExams state
  const fetchExams = async () => {
    const token = localStorage.getItem('access_token');
    const headers = { 'Authorization': `Bearer ${token}` };

    try {
      const examRes = await fetch('/api/exams/', { headers });
      if (examRes.ok) {
        const examsData = await examRes.json();
        // Handle paginated response
        const examsList = Array.isArray(examsData) ? examsData : (examsData.results || []);
        // Map backend exams to frontend format
        const mappedExams: Exam[] = examsList.map((e: any) => ({
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
          department: e.specialization?.name as EngineeringDepartment,
          totalPoints: e.total_points,
          passingScore: e.passing_score
        }));
        if (user) {
          setMyExams(mappedExams.filter(ex => ex.instructorId === user.id));
        }
      }
    } catch (err) {
      console.error("Failed to fetch exams", err);
    }
  };

  // Fetch exams and specializations on mount
  useEffect(() => {
    const fetchData = async () => {
      const token = localStorage.getItem('access_token');
      const headers = { 'Authorization': `Bearer ${token}` };

      try {
        // Fetch Specializations
        const specRes = await fetch('/api/accounts/specializations/', { headers });
        if (specRes.ok) {
          const specs = await specRes.json();
          // Handle paginated response
          const specsList = Array.isArray(specs) ? specs : (specs.results || []);
          setSpecializations(specsList);
        }

        // Fetch Exams using the new function
        await fetchExams();

        // Fetch Submissions
        const subRes = await fetch('/api/submissions/exam_assignments/', { headers });
        if (subRes.ok) {
          const subData = await subRes.json();
          const subList = Array.isArray(subData) ? subData : (subData.results || []);
          // Map backend data to frontend interface
          const mappedSubmissions: ExamAssignment[] = subList.map((s: any) => {
            const responses: any = {};
            if (s.responses && Array.isArray(s.responses)) {
              s.responses.forEach((r: any) => {
                if (r.answer_text) {
                  responses[r.question] = r.answer_text;
                } else if (r.answer_options && r.answer_options.length > 0) {
                  // For single choice, we might want just the string, but type is string | string[]
                  // If it's multiple choice (one answer), frontend might expect a string ID?
                  // Let's check how TakeExam stores it. It stores string for MC, array for MS.
                  // Backend always sends list for answer_options.
                  if (r.answer_options.length === 1) {
                    responses[r.question] = r.answer_options[0];
                  } else {
                    responses[r.question] = r.answer_options;
                  }
                }
              });
            }

            return {
              id: s.id,
              student: s.student,
              examId: s.exam.id, // Extract ID from nested object
              status: s.status,
              responses: responses,
              score: s.score,
              submittedAt: s.submitted_at,
              suspiciousActivityCount: 0, // Default
              retakeCount: s.retake_count || 0
            };
          });
          setAllSubmissions(mappedSubmissions);
        }

        // TODO: Fetch students for roster
        // For now, empty list
        setAllStudents([]);

      } catch (err) {
        console.error("Failed to fetch data", err);
      }
    };
    if (user) {
      fetchData();
    }
  }, [user]);

  const fetchExamDetails = async (examId: string) => {
    const token = localStorage.getItem('access_token');
    try {
      const res = await fetch(`/api/exams/${examId}/`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        // Map details including questions
        const fullExam: Exam = {
          id: data.id,
          title: data.title,
          durationMinutes: data.duration_minutes,
          retakeLimit: data.retake_limit,
          instructorId: data.instructor.id,
          instructorName: `${data.instructor.first_name} ${data.instructor.last_name}`,
          department: data.specialization?.name as EngineeringDepartment,
          questions: data.questions.map((q: any) => {
            const options = q.options.map((o: any) => ({
              id: o.id,
              text: o.option_text,
              isCorrect: o.is_correct
            }));

            // Set correctAnswer based on which option(s) have is_correct=true
            let correctAnswer: string | string[] | undefined;
            if (q.question_type === 'multiple_choice') {
              const correctOption = options.find((o: any) => o.isCorrect);
              correctAnswer = correctOption?.id;
            } else if (q.question_type === 'multiple_select') {
              correctAnswer = options.filter((o: any) => o.isCorrect).map((o: any) => o.id);
            }

            return {
              id: q.id,
              text: q.question_text,
              questionType: q.question_type as QuestionType,
              points: parseFloat(q.points),
              orderIndex: q.order_index,
              options: options,
              correctAnswer: correctAnswer
            };
          }).sort((a: any, b: any) => a.orderIndex - b.orderIndex)
        };
        setSelectedExam(fullExam);
      }
    } catch (e) {
      console.error("Failed to fetch exam details", e);
    }
  };

  const instructorDepartments = useMemo(() => {
    const depts = myExams.map(exam => exam.department);
    return [...new Set(depts)];
  }, [myExams]);

  const relevantStudents = useMemo(() => {
    // Filter students based on instructor departments
    // Since we don't have all users, we use the empty allStudents list or fetched list
    return allStudents.filter(u => u.role === Role.Student && u.department && instructorDepartments.includes(u.department));
  }, [allStudents, instructorDepartments]);

  const needsGradingCount = useMemo(() => {
    if (!selectedExam) return 0;
    return allSubmissions.filter(s => s.examId === selectedExam.id && s.status === SubmissionStatus.Submitted).length;
  }, [allSubmissions, selectedExam]);

  const handleSaveExam = async () => {
    if (!selectedExam) return;

    setSaveStatus('saving');
    const token = localStorage.getItem('access_token');

    // Find specialization ID
    const specId = specializations.find(s => s.name === selectedExam.department)?.id;
    if (!specId) {
      console.error("Invalid specialization");
      setSaveStatus('idle');
      return;
    }

    // Map to backend format
    const payload = {
      title: selectedExam.title,
      description: "Created via Frontend",
      specialization: specId,
      duration_minutes: selectedExam.durationMinutes,
      retake_limit: selectedExam.retakeLimit,
      questions: selectedExam.questions.map((q, idx) => ({
        id: q.id.startsWith('q-') ? undefined : q.id, // Send ID for existing questions, undefined for temp IDs
        question_text: q.text,
        question_type: q.questionType,
        points: q.points,
        order_index: idx,
        options: (q.options || []).map((o, oIdx) => ({
          id: o.id && !o.id.startsWith('opt-') ? o.id : undefined, // Include option IDs if they exist
          option_text: o.text,
          is_correct: o.isCorrect || false,
          order_index: oIdx
        }))
      }))
    };

    try {
      const isNew = selectedExam.id.startsWith('exam-');
      const url = isNew ? '/api/exams/' : `/api/exams/${selectedExam.id}/`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const savedData = await res.json();
        setSaveStatus('saved');

        // Update the selected exam with ALL the saved data to get real IDs
        const updatedExam: Exam = {
          id: savedData.id,
          title: savedData.title,
          durationMinutes: savedData.duration_minutes,
          retakeLimit: savedData.retake_limit,
          instructorId: savedData.instructor.id,
          instructorName: `${savedData.instructor.first_name} ${savedData.instructor.last_name}`,
          department: savedData.specialization?.name as EngineeringDepartment,
          questions: (savedData.questions || []).map((q: any) => {
            const options = (q.options || []).map((o: any) => ({
              id: o.id,
              text: o.option_text,
              isCorrect: o.is_correct
            }));

            // Set correctAnswer based on which option(s) have is_correct=true
            let correctAnswer: string | string[] | undefined;
            if (q.question_type === 'multiple_choice') {
              const correctOption = options.find((o: any) => o.isCorrect);
              correctAnswer = correctOption?.id;
            } else if (q.question_type === 'multiple_select') {
              correctAnswer = options.filter((o: any) => o.isCorrect).map((o: any) => o.id);
            }

            return {
              id: q.id,
              text: q.question_text,
              questionType: q.question_type as QuestionType,
              points: parseFloat(q.points),
              orderIndex: q.order_index,
              options: options,
              correctAnswer: correctAnswer
            };
          }).sort((a: any, b: any) => a.orderIndex - b.orderIndex)
        };
        setSelectedExam(updatedExam);

        // Re-fetch the exam list to show the newly created/updated exam immediately
        await fetchExams();

        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        console.error("Save failed", await res.text());
        setSaveStatus('idle');
      }
    } catch (e) {
      console.error("Save error", e);
      setSaveStatus('idle');
    }
  };

  const handleUpdateSubmission = async (updatedSubmission: ExamAssignment) => {
    console.log('Saving grade to backend:', updatedSubmission.id, 'Score:', updatedSubmission.score, 'Status:', updatedSubmission.status);

    // Update local state immediately for UI responsiveness
    setAllSubmissions(prev => prev.map(s => s.id === updatedSubmission.id ? updatedSubmission : s));

    // Save to backend
    const token = localStorage.getItem('access_token');
    try {
      const res = await fetch(`/api/submissions/exam_assignments/${updatedSubmission.id}/`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          score: updatedSubmission.score,
          status: updatedSubmission.status
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error('Failed to save grade. Status:', res.status, 'Error:', errorText);
      } else {
        console.log('Grade saved successfully!');
      }
    } catch (e) {
      console.error('Error saving grade', e);
    }
  };

  const handleCreateNewExam = () => {
    if (!user) return;
    const newExam: Exam = {
      id: `exam-${Date.now()}`,
      title: 'Untitled Exam',
      durationMinutes: 60,
      retakeLimit: 1,
      questions: [],
      instructorId: user.id,
      instructorName: user.firstName,
      department: user.department || EngineeringDepartment.Mechanical,
    };
    setSelectedExam(newExam);
    setView('builder');
  }

  const handleSelectExam = (exam: Exam) => {
    fetchExamDetails(exam.id);
    setView('grading'); // Default to grading or builder? Maybe builder if instructor?
    // Logic in original was: click "Submissions" -> grading, "Edit" -> builder
    // We need to handle that in the render part.
  };

  const handleBackToExamList = async () => {
    // Refresh the exam list before going back to ensure new exams appear
    await fetchExams();
    setSelectedExam(null);
  };

  const handleDeleteExam = async (examId: string, examTitle: string) => {
    // Confirm deletion
    if (!window.confirm(`Are you sure you want to delete "${examTitle}"? This action cannot be undone.`)) {
      return;
    }

    const token = localStorage.getItem('access_token');
    try {
      const res = await fetch(`/api/exams/${examId}/`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (res.ok) {
        // Refresh the exam list to remove the deleted exam
        await fetchExams();
        // If the deleted exam was selected, clear selection
        if (selectedExam?.id === examId) {
          setSelectedExam(null);
        }
      } else {
        console.error("Delete failed", await res.text());
        alert("Failed to delete exam. Please try again.");
      }
    } catch (e) {
      console.error("Delete error", e);
      alert("An error occurred while deleting the exam.");
    }
  };

  // Main content for when an exam is selected
  const renderExamEditor = () => {
    if (!selectedExam) return null;

    const submissionsForExam = allSubmissions.filter(s => s.examId === selectedExam.id);

    return (
      <>
        <div className="flex-shrink-0 border-b border-gray-700 mb-6">
          <nav className="-mb-px flex space-x-8" aria-label="Tabs">
            <button
              onClick={() => setView('builder')}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${view === 'builder' ? 'border-sky-500 text-sky-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}
            >
              Exam Builder
            </button>
            <button
              onClick={() => setView('grading')}
              className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm relative ${view === 'grading' ? 'border-sky-500 text-sky-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}
            >
              Grading
              {needsGradingCount > 0 && (
                <span className="ml-2 bg-red-600 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
                  {needsGradingCount}
                </span>
              )}
            </button>
          </nav>
        </div>
        <main className="flex-grow flex flex-col min-h-0">
          {view === 'builder' ? (
            <CreateExamPage
              exam={selectedExam}
              onExamChange={setSelectedExam}
              questionBank={questionBank}
              onUpdateQuestionBank={setQuestionBank}
            />
          ) : (
            <GradingPage exam={selectedExam} submissions={submissionsForExam} onUpdateSubmission={handleUpdateSubmission} />
          )}
        </main>
      </>
    );
  };

  // View for the exam list, grouped by department
  const ExamsView: React.FC = () => {
    const examsByDepartment = useMemo(() => {
      // FIX: Explicitly type the accumulator `acc` to ensure correct type inference.
      // This prevents the `exams` variable from being inferred as `unknown` later on.
      return myExams.reduce((acc: Record<string, Exam[]>, exam) => {
        const dept = exam.department;
        if (!acc[dept]) {
          acc[dept] = [];
        }
        acc[dept].push(exam);
        return acc;
      }, {});
    }, [myExams]);

    return (
      <div className="flex-grow flex flex-col">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold">My Exams</h2>
          <button onClick={handleCreateNewExam} className="px-4 py-2 text-sm rounded-md bg-sky-600 hover:bg-sky-500 text-white font-semibold transition">
            + Create New Exam
          </button>
        </div>
        <div className="space-y-6 overflow-y-auto pr-2">
          {Object.entries(examsByDepartment).map(([department, exams]: [string, Exam[]]) => (
            <div key={department}>
              <h3 className="text-lg font-semibold text-sky-400 mb-2">{department}</h3>
              <div className="space-y-4 border-l-2 border-gray-700 pl-4">
                {exams.map(exam => (
                  <div key={exam.id} className="bg-gray-800 p-4 rounded-lg flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-white">{exam.title}</p>
                      <p className="text-xs text-gray-400">{exam.questions.length} Questions | {allSubmissions.filter(s => s.examId === exam.id).length} Submissions</p>
                    </div>
                    <div className="space-x-4">
                      <button onClick={() => { fetchExamDetails(exam.id); setView('grading'); }} className="font-medium text-sky-400 hover:underline text-sm">Submissions</button>
                      <button onClick={() => { fetchExamDetails(exam.id); setView('builder'); }} className="font-medium text-green-400 hover:underline text-sm">Edit</button>
                      <button onClick={() => handleDeleteExam(exam.id, exam.title)} className="font-medium text-red-400 hover:underline text-sm">Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {myExams.length === 0 && (
            <div className="text-center py-10 text-gray-500">
              <p>You haven't created any exams yet.</p>
              <button onClick={handleCreateNewExam} className="mt-4 font-medium text-sky-400 hover:underline">
                Create your first exam
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  // View for student roster
  const StudentsView: React.FC = () => {
    const [studentSearch, setStudentSearch] = useState('');
    const [departmentFilter, setDepartmentFilter] = useState('all');

    const filteredStudents = useMemo(() => {
      return relevantStudents.filter(student => {
        const matchesSearch = student.firstName.toLowerCase().includes(studentSearch.toLowerCase()) || student.email.toLowerCase().includes(studentSearch.toLowerCase());
        const matchesDept = departmentFilter === 'all' || student.department === departmentFilter;
        return matchesSearch && matchesDept;
      });
    }, [relevantStudents, studentSearch, departmentFilter]);

    return (
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6 flex-grow flex flex-col">
        <div className="flex-shrink-0 flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-gray-200">Student Roster ({filteredStudents.length})</h2>
          <div className="flex items-center space-x-2">
            <select value={departmentFilter} onChange={e => setDepartmentFilter(e.target.value)} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm">
              <option value="all">All My Departments</option>
              {instructorDepartments.map(dept => <option key={dept} value={dept}>{dept}</option>)}
            </select>
            <input type="text" placeholder="Search students..." value={studentSearch} onChange={e => setStudentSearch(e.target.value)} className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm" />
          </div>
        </div>
        <div className="flex-grow overflow-y-auto">
          <table className="w-full text-sm text-left text-gray-300">
            <thead className="text-xs text-gray-400 uppercase bg-gray-700 sticky top-0">
              <tr>
                <th scope="col" className="px-6 py-3">Name</th>
                <th scope="col" className="px-6 py-3">Email</th>
                <th scope="col" className="px-6 py-3">Department</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {filteredStudents.map(student => (
                <tr key={student.id} className="hover:bg-gray-700/50">
                  <td className="px-6 py-4 font-medium text-white whitespace-nowrap">{student.firstName}</td>
                  <td className="px-6 py-4">{student.email}</td>
                  <td className="px-6 py-4">{student.department}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredStudents.length === 0 && (
            <div className="text-center py-10 text-gray-500">
              <p>No students found matching your criteria.</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderDashboardContent = () => {
    switch (currentTab) {
      case 'exams':
        return <ExamsView />;
      case 'students':
        return <StudentsView />;
      default:
        return null;
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 flex flex-col min-h-screen">
      <header className="flex-shrink-0 bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4 mb-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          {selectedExam && (
            <button onClick={handleBackToExamList} className="text-gray-400 hover:text-white transition" title="Back to my exams">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 15l-3-3m0 0l3-3m-3 3h8M3 12a9 9 0 1118 0 9 9 0 01-18 0z" /></svg>
            </button>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-white truncate">{selectedExam ? selectedExam.title : "Instructor Dashboard"}</h1>
            <p className="text-sm text-gray-400 mt-1">Welcome, {user?.firstName} (Instructor)</p>
          </div>
        </div>
        <div className="flex items-center space-x-4">
          {selectedExam && (
            <button
              onClick={handleSaveExam}
              disabled={saveStatus !== 'idle'}
              className={`px-4 py-2 w-28 text-center rounded-md text-white font-bold transition shadow-lg ${saveStatus === 'saved' ? 'bg-green-600' : 'bg-sky-600 hover:bg-sky-500'} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : 'Save Exam'}
            </button>
          )}
          <button onClick={logout} className="px-4 py-2 rounded-md bg-gray-600 hover:bg-gray-500 text-white font-semibold transition">
            Logout
          </button>
        </div>
      </header>

      {selectedExam ? renderExamEditor() : (
        <>
          <div className="flex-shrink-0 border-b border-gray-700 mb-6">
            <nav className="-mb-px flex space-x-8" aria-label="Tabs">
              <button
                onClick={() => setCurrentTab('exams')}
                className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${currentTab === 'exams' ? 'border-sky-500 text-sky-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}
              >
                Exams
              </button>
              <button
                onClick={() => setCurrentTab('students')}
                className={`whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm ${currentTab === 'students' ? 'border-sky-500 text-sky-400' : 'border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500'}`}
              >
                Students
              </button>
            </nav>
          </div>
          <main className="flex-grow flex flex-col min-h-0">
            {renderDashboardContent()}
          </main>
        </>
      )}
    </div>
  );
};

export default InstructorDashboard;