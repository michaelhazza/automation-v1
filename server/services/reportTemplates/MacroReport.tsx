import React from 'react';
import { Document, Page, View, Text, StyleSheet } from '@react-pdf/renderer';
import type { MacroReportInput } from '../reportRenderingService.js';

const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: 'Helvetica', fontSize: 11, lineHeight: 1.5 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 8 },
  subtitle: { fontSize: 12, color: '#666', marginBottom: 4 },
  sectionHeading: { fontSize: 14, fontWeight: 'bold', marginTop: 20, marginBottom: 8 },
  bullet: { marginBottom: 4, paddingLeft: 12 },
  body: { marginBottom: 6 },
  analysisHeading: { fontSize: 12, fontWeight: 'bold', marginTop: 12, marginBottom: 4 },
  excerpt: { fontFamily: 'Courier', fontSize: 9, color: '#444', marginTop: 8 },
});

export function MacroReport(input: MacroReportInput) {
  return (
    <Document producer={`automation-os-pdf/${input.pdfRendererVersion}`}>
      <Page size="A4" style={styles.page}>
        {/* Cover */}
        <Text style={styles.title}>{input.source.videoTitle}</Text>
        <Text style={styles.subtitle}>{input.date} · {input.source.publishedDate}</Text>
        <Text style={styles.subtitle}>{input.source.sourceUrl}</Text>

        {/* Executive Summary */}
        <Text style={styles.sectionHeading}>Executive Summary</Text>
        {input.executiveSummary.map((bullet, i) => (
          <Text key={i} style={styles.bullet}>• {bullet}</Text>
        ))}

        {/* Full Analysis */}
        <Text style={styles.sectionHeading}>Full Analysis</Text>
        {input.fullAnalysis.map((section, i) => (
          <View key={i}>
            <Text style={styles.analysisHeading}>{section.heading}</Text>
            <Text style={styles.body}>{section.body}</Text>
          </View>
        ))}

        {/* Transcript Excerpt */}
        {input.transcriptExcerpt != null && (
          <View>
            <Text style={styles.sectionHeading}>Transcript Excerpt</Text>
            <Text style={styles.excerpt}>{input.transcriptExcerpt}</Text>
          </View>
        )}
      </Page>
    </Document>
  );
}
