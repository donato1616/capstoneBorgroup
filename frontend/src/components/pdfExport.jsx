import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export const exportDashboardToPDF = async (user, activeTab, additionalData = {}) => {
  try {
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    
    // Add header
    pdf.setFillColor(36, 115, 54); // Olive color
    pdf.rect(0, 0, pageWidth, 30, 'F');
    
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(20);
    pdf.setFont(undefined, 'bold'); // Make title bold
    pdf.text('EBRS Insights - Analytical Report', pageWidth / 2, 15, { align: 'center' });
    pdf.setFont(undefined, 'normal'); // Reset to normal for other text
    
    pdf.setFontSize(12);
    pdf.text(`Generated on: ${new Date().toLocaleDateString()}`, pageWidth / 2, 22, { align: 'center' });
    
    // Add user information
    pdf.setTextColor(0, 0, 0);
    pdf.setFontSize(10);
    let yPosition = 40;
    
    pdf.setFont(undefined, 'bold');
    pdf.text('User Information:', 20, yPosition);
    pdf.setFont(undefined, 'normal');
    yPosition += 7;
    pdf.text(`Name: ${user.name}`, 20, yPosition);
    yPosition += 5;
    pdf.text(`Role: ${user.role}`, 20, yPosition);
    yPosition += 5;
    pdf.text(`Current Section: ${getSectionName(user.role, activeTab)}`, 20, yPosition);
    yPosition += 15;

    // For all users, capture the current active tab/section
    await captureCurrentTab(pdf, user, activeTab, yPosition);
    
    // Add footer to all pages
    const pageCount = pdf.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      pdf.setPage(i);
      pdf.setFontSize(8);
      pdf.setTextColor(128, 128, 128);
      pdf.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
      pdf.text('Confidential - EBRS Insights System Report', pageWidth / 2, pageHeight - 5, { align: 'center' });
    }
    
    // Save the PDF
    pdf.save(`EBRS-Report-${user.name}-${getSectionName(user.role, activeTab).replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`);
    
    return true;
  } catch (error) {
    console.error('Error generating PDF:', error);
    alert('Error generating PDF report. Please try again.');
    return false;
  }
};

const captureCurrentTab = async (pdf, user, activeTab, startYPosition) => {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  let yPosition = startYPosition;

  // Add section title
  pdf.setFont(undefined, 'bold');
  pdf.text(`${getSectionName(user.role, activeTab)} - Analytical Findings`, 20, yPosition);
  yPosition += 8;

  // Add analytical findings for the current tab
  pdf.setFont(undefined, 'normal');
  const findings = generateAnalyticalFindings(user.role, activeTab, {});
  const splitText = pdf.splitTextToSize(findings, pageWidth - 40);
  pdf.text(splitText, 20, yPosition);
  yPosition += (splitText.length * 5) + 10;

  // Add recommendations if available
  const recommendations = generateRecommendations(user.role, activeTab);
  if (recommendations) {
    if (yPosition > pageHeight - 50) {
      pdf.addPage();
      yPosition = 20;
    }
    
    pdf.setFont(undefined, 'bold');
    pdf.text('Key Recommendations:', 20, yPosition);
    pdf.setFont(undefined, 'normal');
    yPosition += 7;
    
    const splitRec = pdf.splitTextToSize(recommendations, pageWidth - 40);
    pdf.text(splitRec, 20, yPosition);
    yPosition += (splitRec.length * 5) + 15;
  }

  // Capture current tab screenshot
  try {
    if (yPosition > pageHeight - 100) {
      pdf.addPage();
      yPosition = 20;
    }
    
    pdf.setFont(undefined, 'bold');
    pdf.text('Current Dashboard View:', 20, yPosition);
    yPosition += 7;

    // Try to capture the specific tab content first, fall back to main content
    const tabContentElement = document.querySelector(`[data-tab="${activeTab}"]`) || 
                             document.querySelector(`[data-analytics-section="${activeTab}"]`) ||
                             document.getElementById('main-content') ||
                             document.querySelector('.dashboard-content') ||
                             document.body;

    if (tabContentElement) {
      const canvas = await html2canvas(tabContentElement, {
        scale: 0.7,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        scrollY: -window.scrollY
      });

      const imgData = canvas.toDataURL('image/jpeg', 0.8);
      const imgWidth = pageWidth - 40;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      if (yPosition + imgHeight > pageHeight - 20) {
        pdf.addPage();
        yPosition = 20;
      }

      pdf.addImage(imgData, 'JPEG', 20, yPosition, imgWidth, imgHeight);
      yPosition += imgHeight + 10;
    }
  } catch (screenshotError) {
    console.warn('Could not capture dashboard screenshot:', screenshotError);
    // Add fallback message
    pdf.setFont(undefined, 'italic');
    pdf.text('Dashboard screenshot unavailable', 20, yPosition);
    yPosition += 10;
  }

  return yPosition;
};

// Helper functions (keep these as they are)
const getSectionName = (role, activeTab) => {
  const sections = {
    admin: {
      overview: 'Dataset Overview',
      completion: 'Completion Analytics',
      predictive: 'Predictive Insights',
      prescriptive: 'Prescriptive Insights',
      field: 'Field Management',
      audit: 'Audit Trail',
      profile: 'Admin Profile'
    },
    field: {
      home: 'Field Dashboard',
      surveys: 'My Surveys',
      assignments: 'Assignments',
      uploads: 'Uploads',
      announcements: 'Announcements',
      profile: 'Field Profile'
    },
    analyst: {
      a_home: 'Analyst Dashboard',
      a_reports: 'Reports',
      a_generate: 'Generate Reports',
      a_data: 'Data Explorer',
      a_profile: 'Analyst Profile'
    }
  };
  
  return sections[role]?.[activeTab] || 'Dashboard';
};

const generateAnalyticalFindings = (role, activeTab, data) => {
  const baseText = `This report summarizes the analytical findings from the EBRS Insights system. The analysis covers key performance indicators, data quality metrics, and operational insights relevant to your current dashboard view.\n\n`;
  
  const roleSpecificText = {
    admin: {
      overview: 'Dataset overview analysis reveals comprehensive data collection patterns, quality assessment scores, and completion rates across all active surveys. Key trends indicate areas of strong performance and opportunities for improvement in data management processes.',
      completion: 'Completion analytics provide insights into survey progress, researcher productivity, and geographic coverage. The data highlights completion rates, pending assignments, and identifies regions requiring additional resources or attention.',
      predictive: 'Predictive models forecast future trends based on historical data patterns and current trajectories. These insights help anticipate survey completion timelines, resource requirements, and potential bottlenecks in the data collection pipeline.',
      prescriptive: 'Prescriptive insights recommend optimal actions based on predictive analysis and resource constraints. These data-driven recommendations aim to improve efficiency, allocate resources effectively, and enhance overall system performance.',
      field: 'Field management overview shows researcher performance metrics, assignment distribution patterns, and resource allocation efficiency. The analysis identifies top performers, training needs, and optimal assignment strategies.',
      audit: 'Audit trail provides comprehensive tracking of all system activities, data modifications, and user interactions. This ensures data integrity, compliance with protocols, and transparent operational oversight.'
    },
    field: {
      home: 'Field dashboard summary provides an overview of assigned surveys, completion status, upcoming deadlines, and performance metrics. The analysis helps prioritize tasks and optimize fieldwork efficiency.',
      surveys: 'My surveys analysis shows personal progress metrics, response patterns, data quality indicators, and submission history. This comprehensive view supports continuous improvement in data collection practices.',
      assignments: 'Assignment overview details task distribution, priority levels, geographic coverage, and completion timelines. The analysis helps optimize route planning and time management for field operations.',
      uploads: 'Upload history and data submission metrics with quality assessment indicators. This section tracks submission frequency, success rates, and identifies any patterns in data quality issues.',
      announcements: 'Summary of recent system announcements, policy updates, and important operational communications. This ensures field researchers stay informed about procedural changes and priority updates.'
    },
    analyst: {
      a_home: 'Analyst workspace dashboard provides comprehensive data exploration tools, reporting capabilities, and analytical overviews. This central hub supports data-driven decision making and insights generation.',
      a_reports: 'Generated reports library contains detailed analytical insights, data visualizations, and trend analyses. These reports support stakeholder communications and evidence-based planning.',
      a_generate: 'Custom report generation metrics and template utilization statistics. This section tracks report frequency, usage patterns, and supports optimization of reporting workflows.',
      a_data: 'Data explorer findings include dataset analysis results, pattern identification, correlation insights, and data quality assessments. These tools enable deep dive analysis and hypothesis testing.'
    }
  };
  
  return baseText + (roleSpecificText[role]?.[activeTab] || 'Comprehensive system analysis completed with all relevant metrics and performance indicators reviewed.');
};

const generateRecommendations = (role, activeTab) => {
  const recommendations = {
    admin: {
      overview: '1. Review data quality metrics weekly\n2. Allocate additional resources to low-performing regions\n3. Schedule system maintenance during low-activity periods\n4. Update dataset validation rules based on findings',
      completion: '1. Reassign overdue surveys to available researchers\n2. Provide additional training for low-completion regions\n3. Adjust timelines based on current completion rates\n4. Implement incentive programs for high performers',
      predictive: '1. Pre-allocate resources for predicted high-demand periods\n2. Adjust staffing based on forecasted workload\n3. Proactively address potential bottlenecks\n4. Update predictive models with latest data',
      prescriptive: '1. Implement recommended resource allocation changes\n2. Schedule system optimizations as suggested\n3. Review and adjust field assignments per recommendations\n4. Monitor impact of implemented changes',
      field: '1. Provide targeted training for skill gaps identified\n2. Redistribute workload based on performance metrics\n3. Implement mentorship programs for new researchers\n4. Review and update field protocols',
      audit: '1. Address any compliance issues identified\n2. Enhance security measures for sensitive operations\n3. Update access controls based on usage patterns\n4. Schedule regular compliance reviews'
    },
    field: {
      home: '1. Prioritize surveys approaching deadlines\n2. Coordinate with team members for efficient coverage\n3. Update status regularly for accurate reporting\n4. Report any field challenges promptly',
      surveys: '1. Focus on completing pending high-priority surveys\n2. Review data quality feedback for improvement\n3. Batch similar surveys for efficiency\n4. Sync data regularly to avoid backlog',
      assignments: '1. Plan routes to minimize travel time between assignments\n2. Group assignments by geographic proximity\n3. Coordinate timing with weather conditions\n4. Prepare equipment and forms in advance',
      uploads: '1. Regularize upload schedule to avoid data accumulation\n2. Verify data quality before submission\n3. Maintain backup of submitted data\n4. Report any upload issues immediately',
      announcements: '1. Review all new announcements weekly\n2. Implement procedure changes promptly\n3. Seek clarification for unclear updates\n4. Share relevant information with team members'
    },
    analyst: {
      a_home: '1. Schedule regular data review sessions\n2. Update analytical models with new data\n3. Coordinate findings with field operations\n4. Document insights for knowledge sharing',
      a_reports: '1. Standardize report templates for consistency\n2. Automate recurring report generation\n3. Validate data sources before reporting\n4. Share insights with relevant stakeholders',
      a_generate: '1. Develop custom templates for frequent report types\n2. Train team members on report generation tools\n3. Optimize query performance for large datasets\n4. Implement version control for reports',
      a_data: '1. Document data exploration findings systematically\n2. Share significant patterns with relevant teams\n3. Update data dictionaries regularly\n4. Validate data quality before deep analysis'
    }
  };
  
  return recommendations[role]?.[activeTab] || '1. Continue regular monitoring of system metrics\n2. Document any unusual patterns or anomalies\n3. Coordinate findings with relevant team members\n4. Update procedures based on analytical insights';
};